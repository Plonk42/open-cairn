# Recherche et coordonnées du curseur

## Pour les utilisateurs

### Recherche

La barre de recherche en haut à gauche accepte :

- une **adresse** (rue, ville, code postal)
- un **lieu-dit** ou **POI** (refuge, sommet, lac, station…)
- une **commune**

Au-delà de **2 caractères**, des suggestions s'affichent en dessous (max 8). Naviguez
avec ↑ / ↓, validez avec **Entrée**, ou cliquez. La carte zoome alors sur le résultat.

### Coordonnées du curseur

En bas à gauche, un encadré affiche en temps réel la **longitude / latitude** sous le
curseur. Un petit sélecteur juste à côté permet de choisir le format d'affichage :

- **Décimal** : `45.92143, 6.86781` (5 décimales ≈ 1 m)
- **DMS** : `45°55'17.2"N, 6°52'04.1"E` (degrés-minutes-secondes)
- **DDM** : `45°55.287'N, 6°52.069'E` (degrés + minutes décimales)

**Clic droit** sur la carte copie les coordonnées du point cliqué dans le presse-papier,
dans le format actuellement sélectionné.

### Limitations

- Les services de géocodage IGN couvrent **la France** (métropole + DOM/TOM). Une
  recherche internationale renverra peu ou pas de résultats.
- Si la requête ne retourne **aucun** résultat, aucun message n'est affiché ; le menu
  est juste vide.
- La **distinction adresse / POI** est laissée au service IGN ; certaines stations
  ou refuges peuvent être mal classifiés.

---

## Pour les développeurs

### Fichiers

| Fichier | Rôle |
|---------|------|
| [src/lib/ignGeocoding.ts](../src/lib/ignGeocoding.ts) | Wrappers `completion()` et `search()` IGN |
| [src/components/map/SearchBox.tsx](../src/components/map/SearchBox.tsx) | UI input + dropdown + clavier, debounce 220 ms |
| [src/components/map/CursorCoordinates.tsx](../src/components/map/CursorCoordinates.tsx) | Tracking `mousemove`, formatage déc/DMS, clic droit copy |

### Endpoints IGN

#### Completion (autocomplete)

```
GET https://data.geopf.fr/geocodage/completion
  ?text=<query>
  &maximumResponses=8
  &type=PositionOfInterest,StreetAddress
```

Réponse :

```json
{
  "status": "OK",
  "results": [
    {
      "fulltext": "Refuge du Goûter, Saint-Gervais-les-Bains",
      "x": 6.81234,    // lng
      "y": 45.84321,   // lat
      "city": "Saint-Gervais-les-Bains",
      "kind": "refuge",
      "zipcode": "74170"
    }
  ]
}
```

#### Search

```
GET https://data.geopf.fr/geocodage/search
  ?q=<query>
  &limit=1
  &index=address,poi
```

Réponse GeoJSON :

```json
{
  "features": [
    {
      "geometry": { "coordinates": [lng, lat] },
      "properties": {
        "label": "...",
        "extent": [w, s, e, n]
      }
    }
  ]
}
```

`extent` est utilisé pour fitter la carte sur la bbox du résultat (commune entière vs
adresse précise).

### SearchBox — comportement clé

```mermaid
flowchart TD
    Type[Saisie utilisateur] --> Debounce[Debounce 220 ms]
    Debounce --> Min{≥ 2 chars?}
    Min -->|non| Hide[Cacher dropdown]
    Min -->|oui| Abort[abortRef previous fetch]
    Abort --> Fetch[fetch completion endpoint]
    Fetch --> Show[Afficher max 8 suggestions]
    Show --> KeyNav[Navigation clavier ↑↓ Enter Esc]
    KeyNav --> Pick[Sélection → map.flyTo&#40;{ center, zoom: 14 }&#41;]
```

`abortRef` est un `AbortController` recréé à chaque saisie ; cela annule le fetch
précédent.

### Formatage DMS

```ts
function toDMS(deg: number, posChar: 'N'|'E', negChar: 'S'|'O'): string {
  const sign = deg >= 0 ? posChar : negChar;
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = ((abs - d) * 60 - m) * 60;
  return `${d}°${pad2(m)}'${s.toFixed(1)}"${sign}`;
}
```

Pour la latitude : `posChar='N', negChar='S'`. Pour la longitude : `posChar='E', negChar='O'`.

### Limitations techniques

- **Pas de cache** sur les résultats : retaper la même requête redéclenche un fetch.
- **`max-width` du dropdown** fixé en CSS, peut dépasser sur écrans étroits.
- **Pas de feedback erreur** : si l'API IGN renvoie 5xx, l'utilisateur voit juste un
  dropdown vide.
