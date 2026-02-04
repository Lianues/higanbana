export {};

declare global {
  // jQuery / toastr are globals in SillyTavern
  const $: any;
  const jQuery: any;
  const toastr: any;

  interface SillyTavernGlobal {
    libs?: Record<string, any>;
    getContext?: () => any;
  }

  // NOTE: SillyTavern exposes itself as a global object on window/globalThis.
  // In ES modules, it's safest to access it via `globalThis.SillyTavern`.
  const SillyTavern: SillyTavernGlobal | undefined;
  interface GlobalThis {
    SillyTavern?: SillyTavernGlobal;
  }
}

