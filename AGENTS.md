# AGENTS.md

## Releases

Les releases sont **uniquement déclenchées par des tags** — jamais sur un push de commit classique.

```bash
git tag -m "Release v1.2.3" v1.2.3
git push origin v1.2.3
```

Le workflow `.github/workflows/release.yml` fait alors, automatiquement :

1. `bun install --frozen-lockfile`
2. `bun run compile` (type-check — bloque la release en cas d'erreur)
3. `bun run build` (build de l'extension)
4. Zip de `build/mangamoinsplus-chrome-mv3/` → `mangamoinsplus-<tag>.zip`
5. Création d'une GitHub Release avec le zip + release notes auto-générées

### Points importants

- **Tag = release** : ne pas créer un tag `v*` sur master sans vouloir publier.
- Les tags doivent suivre la numérotation sémantique (`v1.0.0`, `v1.1.0`, …).
- Le numéro de version affiché dans le manifest est géré par WXT depuis `package.json` — **penser à bump `version` dans `package.json` avant de tagger** pour que le build embarque le bon numéro.
- Suivi des runs : onglet *Actions* du repo, ou `gh run list`.
