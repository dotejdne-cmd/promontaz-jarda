/* Kanál ukazuje na v2 (dist/jarda.min.js): jen načte v2, případně verzi zvolenou pro tento prohlížeč. */
import { rootOf, wanted, load } from './channel.js';
(function () {
  if (window.__pmj) return;
  var s = document.currentScript, root = rootOf((s && s.src) || location.href);
  var w = wanted();
  load(root, w || __TARGET__, w ? function () { load(root, __TARGET__); } : null);
})();
