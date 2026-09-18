# TODO

- [ ] Une cote fausse déplace l'ancre sur le mauvais sommet : Le Grand Manti porte 1850 m
      (Wikipédia dit 1818) et la marche s'est éloignée de 355 m du bon point. Rejeter le
      recalage quand le sol d'arrivée dépasse la cote, ou quand la marche a traversé un col.
- [ ] La montée guidée converge vers le maximum local le plus proche : 225 marches calent
      à plus de 40 m sous leur cible et gardent leur ancre d'origine. Sur une crête étroite
      elle peut même s'éloigner du sommet. Piste : élargir le rayon de départ au lieu de le
      réduire quand aucune sonde ne monte, ou sonder deux couronnes.
- [ ] Mont Saint-Eynard et aiguilles de l'Argentière restent sans cote : leur homonyme est
      au-delà de `FAR_NAME_MATCH_M`, ou son sol ne confirme pas sa cote à 20 m près.
- [ ] La signature de cache ne capture que des constantes et des données, pas le code : avoir
      changé la *forme* de la valeur de `farmatches` sans toucher à la signature a fait relire
      un cache incompatible en silence, et perdu 71 cotes sans aucune erreur. Un numéro de
      forme est présent dans la signature de `farmatches`, mais rien ne l'impose ailleurs.
- [ ] Rocher de Lorzier (1838 m, nature `Rochers`, importance 2) est écarté faute d'altitude
      dans toutes les sources, alors que PeakFinder le nomme depuis Chamechaude. Vérifier
      combien de sommets notables sont perdus par cette règle.
- [ ] Champ de vision : PeakFinder cadre à 110° d'horizontale, nous à 70°. Voir si un champ
      plus large est souhaitable en *Point de vue*, ou au moins atteignable au pincement.
- [ ] Le test d'occultation est plus strict que celui de PeakFinder à courte distance :
      `SELF_CLEARANCE` est une *fraction* de la distance (60 m à 4 km, 900 m à 60 km) là où
      PeakFinder pardonne un obstacle à moins de 1 400 m fixes du sommet visé.
- [ ] `tools/check-wikidata2.mjs` n'est pas versionné. Contrairement à `verify-peaks.mjs`, il
      ne dépend d'aucune donnée hors dépôt et pourrait tourner en CI. À nettoyer (`.sort` en
      expression, gabarit imbriqué) avant de le committer.


