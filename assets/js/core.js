/* CEREBRO CORE verifier (drop into any web page, WebView app or Electron app). Public key only: safe to ship.
   Needs window.CEREBRO_STAMP (made by core-sign.js stamp). window.CerebroCore.verify() -> Promise<{ok, display}> */
(function () {
  'use strict';
  var PUB = { kty: 'EC', crv: 'P-256', x: 'aVbDt7phOragjyDhX_FDG0JGDBkn6ddeKPqtbFEMgjc', y: 'GXkWbLLzygL1EUxIZOrpDOHySZWNoIxd6yz2BdmxC2E', ext: true };
  function hex(h) { var a = new Uint8Array(h.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
  function verify() {
    var s = window.CEREBRO_STAMP, subtle = window.crypto && window.crypto.subtle;
    if (!s || !subtle) return Promise.resolve({ ok: false, display: s ? s.display : '' });
    var data = new TextEncoder().encode(['CEREBRO-1', s.owner, s.core, s.project, s.version, s.date, s.tree].join('\n'));
    return subtle.importKey('jwk', PUB, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      .then(function (k) { return subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, hex(s.sig), data); })
      .then(function (ok) { return subtle.digest('SHA-256', hex(s.sig)).then(function (d) { var h = Array.prototype.map.call(new Uint8Array(d).slice(0, 4), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').toUpperCase(); return { ok: !!ok && s.code === 'CRB-' + h.slice(0, 4) + '-' + h.slice(4), display: s.display }; }); })
      .catch(function () { return { ok: false, display: s.display }; });
  }
  window.CerebroCore = { verify: verify };
})();
// CRB-MARK 4930152188f5
