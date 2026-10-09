declare module 'virtual:@astroscope/cap/config' {
  export const path: string;
}

declare module '@cap.js/wasm/browser/cap_wasm_bg.wasm?url' {
  const url: string;
  export default url;
}

declare module '@cap.js/wasm/browser/hashwx.wasm?url' {
  const url: string;
  export default url;
}

declare module 'pako/dist/pako_inflate.min.js?url' {
  const url: string;
  export default url;
}
