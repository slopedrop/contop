# Scoop Bucket for Contop

## Setup

Create a new GitHub repo called `slopedrop/scoop-contop` and push `contop.json` to a `bucket/` directory.

```bash
gh repo create slopedrop/scoop-contop --public --description "Scoop bucket for Contop"
git clone https://github.com/slopedrop/scoop-contop.git
mkdir -p scoop-contop/bucket
cp contop.json scoop-contop/bucket/
cd scoop-contop
git add . && git commit -m "Add contop manifest" && git push
```

Users install with:
```powershell
scoop bucket add contop https://github.com/slopedrop/scoop-contop
scoop install contop
```

## How it works

Scoop downloads and extracts the portable `.zip` build (not the NSIS installer).
Extracted files don't carry the Mark of the Web, so Windows SmartScreen won't trigger.
Python dependencies are installed automatically by the app on first launch.

## Updating for a new release

After each desktop release:

1. Download the portable `.zip` from the GitHub release
2. Get the SHA256: `certutil -hashfile Contop*.zip SHA256`
3. Update `version`, `url`, and `hash` in `bucket/contop.json`
4. Push to the bucket repo
