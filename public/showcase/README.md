# Galerie de scènes showcase

La galerie du Studio LiDAR (bouton « Galerie ») a deux onglets :

- **Mis en avant** — les scènes pré-cuites versionnées dans ce dossier ;
- **Mes vues** — les scènes que vous exportez en local (stockées dans le
  navigateur, comme les derniers nuages chargés) ; rien n'est versionné.

Ce dossier contient les **scènes « Mis en avant »**. Une scène se compose de
trois fichiers **partageant le même identifiant** (`<id>`), générés par le
bouton **« Exporter cette vue »** du studio :

- `<id>.bin` — la **géométrie compressée uniquement** (mesh / nuage de points) ;
- `<id>.json` — le **manifeste éditable** : titre, description, caméra (centre,
  zoom, pitch, bearing, altitude du centre) et ambiance ;
- `<id>.webp` — la vignette d'aperçu.

Cette convention de nommage est le **seul lien** entre les trois fichiers :
`index.json` ne liste que les identifiants. Séparer la présentation (`.json`) de
la géométrie (`.bin`) permet de **retoucher les réglages d'une scène sans
régénérer le fichier binaire** : éditez simplement le manifeste à la main.

## Ajouter une scène exportée

1. Dans le studio, chargez un nuage, réglez l'ambiance, cadrez la vue.
2. Cliquez sur **« Exporter cette vue »**. Une fenêtre demande un **titre**
   et une **description**, puis la destination (cases à cocher, mémorisées) :
   - **Stocker dans « Mes vues »** — enregistre la scène dans le navigateur,
     rouvrable instantanément depuis l'onglet *Mes vues* (rien à publier) ;
   - **Télécharger** — télécharge un unique `scene-AAAAMMJJ-hhmmss.zip`
     contenant les trois fichiers de la scène (à publier ici).

   Cochez les cases voulues, puis cliquez **Exporter**. Un bouton
   **« Télécharger seulement l'image (.png) »** permet aussi de récupérer
   juste la capture d'écran courante, sans créer d'entrée ni d'archive.
3. Pour publier dans *Mis en avant* : décompressez l'archive dans
   `public/showcase/`.
4. Ouvrez le `<id>.json` pour donner un `title` et une `description` parlants.
5. Ajoutez l'`<id>` à la liste `scenes` de `index.json` (voir ci-dessous).

## Importer une scène partagée

L'onglet *Mes vues* a un bouton **« Importer un .zip »** : sélectionnez une
archive `scene-….zip` reçue d'un ami ou exportée depuis un autre ordinateur.
La scène est décodée et ajoutée à *Mes vues* (un nouvel identifiant local est
généré, donc ré-importer ne remplace jamais une vue existante). Aucun fichier
n'est versionné — c'est l'équivalent local de l'export, dans l'autre sens.

## Modifier une scène existante

Ouvrez son `<id>.json` et ajustez `title`, `description`, `camera` ou
`ambiance`, puis sauvegardez. Aucune régénération du `.bin` n'est nécessaire.

## Schéma de `index.json`

`index.json` ne contient que la **liste des identifiants** des scènes à
afficher ; les chemins des fichiers sont déduits par convention
(`showcase/<id>.bin`, `showcase/<id>.json`, `showcase/<id>.webp`).

```jsonc
{
  "scenes": [
    "scene-20260616-095311",
    "scene-20260616-114231"
  ]
}
```

## Schéma de `<id>.json` (manifeste)

```jsonc
{
  "version": 1,
  "title": "Aiguille du Midi",        // affiché dans la galerie (défaut: id)
  "description": "Face nord depuis…",  // optionnel — sous-titre
  "camera": {
    "center": [6.887, 45.879],
    "zoom": 16.8, "pitch": 52, "bearing": 145,
    "centerElevation": 1805            // altitude du centre (cadrage 3D correct)
  },
  "ambiance": { /* shader, soleil, EDL, ombres, opacité, classes… */ }
}
```

Notes :

- Les chemins déduits sont résolus relativement à la racine du site
  (`import.meta.env.BASE_URL`).
- À l'ouverture de la galerie, le manifeste de **chaque** scène listée est
  chargé pour afficher titre + vignette ; la géométrie n'est téléchargée qu'au
  clic. Adapté à des dizaines de scènes.
- Une entrée de `scenes` qui n'est pas une chaîne, ou dont le manifeste est
  introuvable, est ignorée (un avertissement est écrit dans la console).
- Aucune scène n'est versionnée par défaut ; seul ce `README.md` et un
  `index.json` avec une liste d'exemple sont commités.


