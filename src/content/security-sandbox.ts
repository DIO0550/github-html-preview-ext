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

  // A. Network & WebRTC API blocking
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

  var rtcNames = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection'];
  for (var r = 0; r < rtcNames.length; r++) {
    if (rtcNames[r] in window) {
      Object.defineProperty(window, rtcNames[r], {
        value: function() { warn('WebRTC is blocked'); throw new Error('WebRTC is blocked by sandbox'); },
        writable: false, configurable: false
      });
    }
  }

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
  function isExternal(val) {
    if (typeof val !== 'string') return false;
    var v = val.replace(/[\\u0000-\\u0020]+/g, '').toLowerCase();
    return v.indexOf('http://') === 0 || v.indexOf('https://') === 0 || v.indexOf('//') === 0;
  }

  function blockExternalUrl(proto, prop) {
    var descriptor = Object.getOwnPropertyDescriptor(proto, prop);
    var originalSet = descriptor && descriptor.set;
    Object.defineProperty(proto, prop, {
      get: descriptor && descriptor.get ? descriptor.get : function() { return ''; },
      set: function(value) {
        if (isExternal(value)) {
          warn(prop + ' assignment to external URL blocked: ' + value);
          return;
        }
        if (originalSet) { originalSet.call(this, value); }
        else { Element.prototype.setAttribute.call(this, prop, value); }
      },
      configurable: false
    });
  }

  blockExternalUrl(HTMLImageElement.prototype, 'src');
  blockExternalUrl(HTMLScriptElement.prototype, 'src');
  blockExternalUrl(HTMLLinkElement.prototype, 'href');
  blockExternalUrl(HTMLIFrameElement.prototype, 'src');

  var origSetAttribute = Element.prototype.setAttribute;
  var urlAttrs = { src: true, href: true, srcset: true, data: true, poster: true, action: true, formaction: true, ping: true };
  Object.defineProperty(Element.prototype, 'setAttribute', {
    value: function(name, value) {
      var lower = String(name).toLowerCase();
      if (lower === 'ping' || (urlAttrs[lower] && isExternal(String(value)))) {
        warn('setAttribute(' + name + ') to external URL blocked: ' + value);
        return;
      }
      return origSetAttribute.call(this, name, value);
    },
    writable: false, configurable: false
  });

  if (typeof HTMLFormElement !== 'undefined') {
    Object.defineProperty(HTMLFormElement.prototype, 'submit', {
      value: function() { warn('form.submit is blocked'); },
      writable: false, configurable: false
    });
  }

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
  const headMatch = html.match(/<head(?:\s[^>]*)?>/i);
  if (headMatch) {
    const insertPos = html.indexOf(headMatch[0]) + headMatch[0].length;
    return html.slice(0, insertPos) + script + html.slice(insertPos);
  }
  const bodyMatch = html.match(/<body(?:\s[^>]*)?>/i);
  if (bodyMatch) {
    const insertPos = html.indexOf(bodyMatch[0]);
    return html.slice(0, insertPos) + '<head>' + script + '</head>' + html.slice(insertPos);
  }
  return '<head>' + script + '</head>' + html;
}
