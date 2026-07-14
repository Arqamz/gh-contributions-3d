{
  description = "Development environment for gh-contributions-3d";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {

          packages = with pkgs; [
            bun
            nodejs_24 # fallback runtime for deps that need Node

            # code formatting
            treefmt
            prettier
            nixfmt
          ];

          shellHook = ''
            alias dev="bun run dev"
            alias sample="bun run sample"
            alias lint="bun run lint"
          '';
        };
      });

      formatter = forAllSystems (pkgs: pkgs.treefmt);
    };
}
