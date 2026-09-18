# TODO

- [ ] Sommets sans cote : ils ne peuvent pas être recalés, faute de cible pour la marche,
      et ce sont justement les plus mal ancrés (le Néron, le mont Saint-Eynard, le mont
      Rachais, à 600 m – 1,7 km de leur cime). La cote manque *parce que* l'ancre est loin
      du sommet — l'appariement par nom ne porte qu'à 600 m — et l'ancre reste loin *parce
      que* la cote manque. Piste : recaler d'abord sur un maximum local non guidé, puis
      rejouer l'appariement des altitudes depuis la nouvelle position.
- [ ] Une cote fausse déplace l'ancre sur le mauvais sommet : Le Grand Manti porte 1850 m
      (Wikipédia dit 1818) et la marche s'est éloignée de 366 m du bon point. Rejeter le
      recalage quand le sol d'arrivée dépasse la cote, ou quand la marche a traversé un col.
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


