// for some reason this needs to be in its own file

declare module '*.css' {
  const css: string
  export default css
}

// baseline 2025 (chrome 136, firefox 134), not yet in typescript 5.9's lib
// biome-ignore lint/correctness/noUnusedVariables: used in plugins
interface RegExpConstructor {
  escape(text: string): string
}
