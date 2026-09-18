{
  description = "Taut, a client mod for Slack";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      # these lines are rewritten by the release workflow after each desktop release
      version = "3.0.1";
      hashes = {
        x86_64-linux = "sha256-qmCptA9+r0bCZtJTycTHuasEUoHrek3d9CLxnCkQ1BA=";
        aarch64-linux = "sha256-2AzNASZm2WT7GKI1Spvk412cxCfw8r6FFyMioLApGEg=";
      };

      appImages = {
        x86_64-linux = "taut-linux.AppImage";
        aarch64-linux = "taut-linux-arm.AppImage";
      };

      package =
        {
          lib,
          stdenv,
          appimageTools,
          fetchurl,
        }:

        let
          system = stdenv.hostPlatform.system;
          hash = hashes.${system};
        in

        assert lib.assertMsg (
          hash != ""
        ) "flake.nix has no ${system} hash yet";

        let
          pname = "taut";
          src = fetchurl {
            url = "https://github.com/jeremy46231/taut/releases/download/desktop-v${version}/${appImages.${system}}";
            inherit hash;
          };
          contents = appimageTools.extract { inherit pname version src; };
        in
        appimageTools.wrapType2 {
          inherit pname version src;

          extraInstallCommands = ''
            install -Dm444 ${contents}/taut.desktop $out/share/applications/taut.desktop
            substituteInPlace $out/share/applications/taut.desktop \
              --replace-fail 'Exec=AppRun' 'Exec=taut'
            cp -r ${contents}/usr/share/icons $out/share/icons
          '';

          meta = {
            description = "Client mod for Slack";
            homepage = "https://taut.jer.app";
            license = lib.licenses.mit;
            platforms = builtins.attrNames appImages;
            mainProgram = "taut";
            sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
          };
        };

      forSystem = system: rec {
        taut = nixpkgs.legacyPackages.${system}.callPackage package { };
        default = taut;
      };
    in
    {
      packages = nixpkgs.lib.genAttrs (builtins.attrNames appImages) forSystem;

      overlays.default = final: prev: { taut = final.callPackage package { }; };
    };
}
