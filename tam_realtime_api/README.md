# API temps réel TAM

Petite API HTTPS destinée au simulateur SAE.

## Routes

- `GET /health` : vérification simple du service.
- `GET /arrivals?stop_id=<id>&route=<ligne>&limit=4` : prochains passages GTFS-RT pour un arrêt.

Exemple :

```text
https://tam-sae-jielo.duckdns.org/arrivals?stop_id=1234&route=11&limit=4
```

## Déploiement VM

L’API est prévue pour tourner derrière Nginx :

```text
Internet HTTPS -> Nginx -> Gunicorn 127.0.0.1:8000 -> Flask
```

Le service systemd `tam-api.service` doit utiliser :

```text
WorkingDirectory=/home/ubuntu/tam-api
ExecStart=/home/ubuntu/tam-api/.venv/bin/gunicorn -b 127.0.0.1:8000 app:app
```

Commandes de déploiement typiques après copie des fichiers :

```bash
cd /home/ubuntu/tam-api
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart tam-api
```

Sur Ubuntu OCI, penser à ouvrir les ports Nginx dans `iptables` en plus des règles OCI :

```bash
sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## Cache

- GTFS statique routes : 6 h par défaut.
- `TripUpdate.pb` : 15 s par défaut.

Variables d’environnement :

- `TAM_TRIP_UPDATE_CACHE_SECONDS`
- `TAM_GTFS_ROUTE_CACHE_SECONDS`
- `TAM_API_ALLOWED_ORIGINS`
