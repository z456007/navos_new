if (typeof window !== "undefined") {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
  }

  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false
    });
  }

  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = (element: Element) => getComputedStyle(element);
}
