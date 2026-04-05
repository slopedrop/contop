# Homebrew Tap for Contop

## Setup

Create a new GitHub repo called `slopedrop/homebrew-contop` and push the `Casks/` directory to it.

```bash
gh repo create slopedrop/homebrew-contop --public --description "Homebrew tap for Contop Desktop"
git clone https://github.com/slopedrop/homebrew-contop.git
cp -r Casks/ homebrew-contop/
cd homebrew-contop
git add . && git commit -m "Add contop cask" && git push
```

Users install with:
```bash
brew install slopedrop/contop/contop
```

## Updating for a new release

After each desktop release:

1. Download the `.dmg` from the GitHub release
2. Get the SHA256: `shasum -a 256 Contop*.dmg`
3. Update `version` and `sha256` in `Casks/contop.rb`
4. Push to the tap repo
