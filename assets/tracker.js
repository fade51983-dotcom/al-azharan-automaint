// Kraaz Al Azharan — Visitor Tracking Script
// يجمع GCLID, UTM, ValueTrack, referrer, ويرسل إلى /api/track

(function() {
  'use strict';

  // جمع معلومات الإسناد
  var p = new URLSearchParams(window.location.search);
  var data = [];

  // صفحة
  data.push('page=' + encodeURIComponent(window.location.pathname));

  // GCLID / FBCLID
  var gclid = p.get('gclid');
  if (gclid) data.push('gclid=' + encodeURIComponent(gclid));

  var fbclid = p.get('fbclid');
  if (fbclid) data.push('fbclid=' + encodeURIComponent(fbclid));

  // UTM
  ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(function(k){
    var v = p.get(k);
    if (v) data.push(k + '=' + encodeURIComponent(v));
  });

  // ValueTrack (من إعلانات Google إذا أضيفت)
  ['campaign_id','ad_group_id','keyword','kw','creative','match_type','network','device'].forEach(function(k){
    var v = p.get(k);
    if (v) data.push(k + '=' + encodeURIComponent(v));
  });

  // المُحيل
  try {
    var ref = document.referrer;
    if (ref) {
      data.push('ref=' + encodeURIComponent(ref));
      // كلمة البحث من Google
      var ru = new URL(ref);
      if (ru.hostname.indexOf('google.') !== -1) {
        var q = ru.searchParams.get('q');
        if (q) data.push('search_keyword=' + encodeURIComponent(q.slice(0, 80)));
      }
    }
  } catch(e) {}

  // أرسل إشارة تتبع (1x1 GIF)
  var query = data.join('&');
  var img = new Image();
  img.src = '/api/track?' + query + '&_=' + Date.now();
  img.width = 1;
  img.height = 1;
  img.style.cssText = 'position:absolute;left:-9999px;';
  document.body.appendChild(img);

})();
