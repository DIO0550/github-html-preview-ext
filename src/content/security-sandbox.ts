/**
 * Security sandbox script generator.
 * Produces a script that disables dangerous APIs when injected into preview HTML.
 */

/**
 * Create the security sandbox script content as a string.
 * The script is an IIFE that uses Object.defineProperty to prevent re-override.
 * @returns JavaScript source code string
 */
export function createSecuritySandboxScript(): string {
  return `(function() {
  var warn = console.warn.bind(console, '[HTML Preview Sandbox]');

  // A. Network API blocking
  Object.defineProperty(window, 'fetch', {
    value: function() { warn('fetch is blocked'); return Promise.reject(new Error('fetch is blocked by sandbox')); },
    writable: false, configurable: false
  });

  Object.defineProperty(window, 'XMLHttpRequest', {
    value: function() { warn('XMLHttpRequest is blocked'); this.open = function(){}; this.send = function(){}; },
    writable: false, configurable: false
  });

  Object.defineProperty(window, 'WebSocket', {
    value: function() { warn('WebSocket is blocked'); throw new Error('WebSocket is blocked by sandbox'); },
    writable: false, configurable: false
  });

  Object.defineProperty(window, 'EventSource', {
    value: function() { warn('EventSource is blocked'); throw new Error('EventSource is blocked by sandbox'); },
    writable: false, configurable: false
  });

  Object.defineProperty(navigator, 'sendBeacon', {
    value: function() { warn('sendBeacon is blocked'); return false; },
    writable: false, configurable: false
  });

  // B. Web Worker blocking
  Object.defineProperty(window, 'Worker', {
    value: function() { warn('Worker is blocked'); throw new Error('Worker is blocked by sandbox'); },
    writable: false, configurable: false
  });

  Object.defineProperty(window, 'SharedWorker', {
    value: function() { warn('SharedWorker is blocked'); throw new Error('SharedWorker is blocked by sandbox'); },
    writable: false, configurable: false
  });

  // C. Dynamic resource creation blocking
  function blockExternalUrl(proto, prop) {
    var descriptor = Object.getOwnPropertyDescriptor(proto, prop);
    var originalSet = descriptor && descriptor.set;
    Object.defineProperty(proto, prop, {
      get: descriptor && descriptor.get ? descriptor.get : function() { return ''; },
      set: function(value) {
        if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
          warn(prop + ' assignment to external URL blocked: ' + value);
          return;
        }
        if (originalSet) { originalSet.call(this, value); }
        else { this.setAttribute(prop, value); }
      },
      configurable: false
    });
  }

  blockExternalUrl(HTMLImageElement.prototype, 'src');
  blockExternalUrl(HTMLScriptElement.prototype, 'src');
  blockExternalUrl(HTMLLinkElement.prototype, 'href');
  blockExternalUrl(HTMLIFrameElement.prototype, 'src');

  // D. alert/confirm/prompt blocking
  Object.defineProperty(window, 'alert', {
    value: function() { warn('alert is blocked'); },
    writable: false, configurable: false
  });

  Object.defineProperty(window, 'confirm', {
    value: function() { warn('confirm is blocked'); return false; },
    writable: false, configurable: false
  });

  Object.defineProperty(window, 'prompt', {
    value: function() { warn('prompt is blocked'); return null; },
    writable: false, configurable: false
  });

  // E. Navigator API blocking
  Object.defineProperty(navigator, 'clipboard', {
    value: undefined, writable: false, configurable: false
  });

  Object.defineProperty(navigator, 'geolocation', {
    value: undefined, writable: false, configurable: false
  });

  Object.defineProperty(navigator, 'mediaDevices', {
    value: undefined, writable: false, configurable: false
  });

  // F. Dynamic code execution blocking
  Object.defineProperty(window, 'eval', {
    value: function() { warn('eval is blocked'); return undefined; },
    writable: false, configurable: false
  });

  Object.defineProperty(window, 'Function', {
    value: function() { warn('Function constructor is blocked'); throw new Error('Function is blocked by sandbox'); },
    writable: false, configurable: false
  });

  var origSetTimeout = window.setTimeout;
  var origSetInterval = window.setInterval;

  Object.defineProperty(window, 'setTimeout', {
    value: function(fn) {
      if (typeof fn === 'string') { warn('setTimeout with string argument is blocked'); return 0; }
      return origSetTimeout.apply(window, arguments);
    },
    writable: false, configurable: false
  });

  Object.defineProperty(window, 'setInterval', {
    value: function(fn) {
      if (typeof fn === 'string') { warn('setInterval with string argument is blocked'); return 0; }
      return origSetInterval.apply(window, arguments);
    },
    writable: false, configurable: false
  });
})();`;
}

/**
 * Inject the security sandbox script into HTML at the beginning of <head>.
 * If no <head> tag exists, prepends a <head> with the script.
 * @param html - The HTML string to inject into
 * @returns Modified HTML with security sandbox script injected
 */
export function injectSecuritySandbox(html: string): string {
  const script = `<script>${createSecuritySandboxScript()}</script>`;
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch) {
    const insertPos = html.indexOf(headMatch[0]) + headMatch[0].length;
    return html.slice(0, insertPos) + script + html.slice(insertPos);
  }
  // No <head> tag — insert before <body> or at the start
  const bodyMatch = html.match(/<body[^>]*>/i);
  if (bodyMatch) {
    const insertPos = html.indexOf(bodyMatch[0]);
    return html.slice(0, insertPos) + '<head>' + script + '</head>' + html.slice(insertPos);
  }
  return '<head>' + script + '</head>' + html;
}
