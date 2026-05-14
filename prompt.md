I'm looking for the best technical solution to display a map within a web application. This is a new project separated from the current one. It must:
- use the IGN resources
- display the SCAN 25 layer
- 3D elevation layer applied to the base layer (SCAN 25)
- a high resh hillshade based on lidar IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW
- IMPORTANT : the hillshade layer must be blended with the base layer with a multiply (or other) operation, NOT only an opacity percentage

Future needs:
- draw a path on the map, and get it's elevation profile displayed
- compute a path between two points
- publish it on github pages


There is 3 sources of information to get inspiration from:
- cartes-ign-app (the current workspace)
    - cloned from https://github.com/IGNF/cartes-ign-app
    - can display the 3D
    - currently modified to display the lidar hillshade
    - does not support blending: https://github.com/maplibre/maplibre-gl-js/issues/48
- https://cartes.gouv.fr/ : 
    - https://cartes.gouv.fr/explorer-les-cartes?c=5.754625,45.216227&z=11&l=IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW$GEOPORTAIL:OGC:WMTS(4;1;1;0),ORTHOIMAGERY.ORTHOPHOTOS$GEOPORTAIL:OGC:WMTS(1;0;0;0),IGNF_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW$GEOPORTAIL:OGC:WMTS(3;1;0;0),GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR$GEOPORTAIL:OGC:WMTS(2;1;1;0)&w=Route,Isocurve&permalink=yes
    - do not seems to display 3D
    - can display display the lidar hillshade
    - does not support blending
- https://www.geoportail.gouv.fr
    - https://www.geoportail.gouv.fr/carte?c=1.1677184113816175,49.4306770083343&z=15&l0=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2::GEOPORTAIL:OGC:WMTS(1)&l1=IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW(1)&l2=IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW(1)&l3=IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW(1)&permalink=yes
    - display 3D
    - can display display the lidar hillshade
    - does not support blending
    - seems more laggy than cartes-ign-app

Additional resources :
- https://cartes.gouv.fr/aide/fr/guides-developpeur/
- https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/diffusion/wmts/
- plenty of other resources online

Please create a detailled .md document containing:
- a deep analysis of the 3 existing products, including their technical stack, features/capabilities and limitations
- an analysis of all IGN resources available to us, included or not in the 3 existing products. Search online for all relevant information.
- once this analysis is done, describe the best technical solution for the advanced 3D mapping / blending web interface we are looking to build. It can reuse anything existing or take a completely fresh approach if it works better