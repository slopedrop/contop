cask "contop" do
  version "0.1.0-alpha.1"
  sha256 "REPLACE_WITH_SHA256"

  url "https://github.com/slopedrop/contop/releases/download/desktop-v#{version}/Contop.Desktop_#{version}_aarch64.dmg"
  name "Contop Desktop"
  desc "AI-powered remote desktop control from your phone"
  homepage "https://contop.app"

  depends_on macos: ">= :ventura"

  app "Contop Desktop.app"

  zap trash: [
    "~/Library/Application Support/com.mmssw.contop-desktop",
    "~/Library/Caches/com.mmssw.contop-desktop",
    "~/.contop",
  ]
end
