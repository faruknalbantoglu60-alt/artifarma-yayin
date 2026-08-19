/* =========================================================
   ARTIFARMA GROUP — Ortak Çekirdek
   Üç danışmanlık uygulamasının paylaştığı veri katmanı ve gezinme.

   NEDEN GEREKLİ:
   Uygulamalar verilerini "window.storage" üzerinden saklar. Bu arayüz
   yalnızca Claude ortamında hazır gelir. Site kendi alan adında veya
   doğrudan bilgisayarda açıldığında burası devreye girip aynı arayüzü
   tarayıcının kalıcı hafızası (localStorage) ile sağlar.

   Böylece üç uygulamanın iç mantığına hiç dokunulmadan her ortamda
   çalışır. İleride gerçek bir veritabanına geçilmek istenirse
   yalnızca bu dosyadaki dört fonksiyon değiştirilir.
   ========================================================= */
(function () {
  'use strict';

  var PREFIX = 'artifarma:';

  /* ---------- 1) Veri katmanı ---------- */
  var hasNative = typeof window.storage === 'object'
    && window.storage !== null
    && typeof window.storage.get === 'function';

  /* Kendi veri katmanı olan uygulamalar <html data-af-no-storage> ile
     bu bölümü devre dışı bırakır; yalnızca gezinme düğmesini kullanır. */
  var kendiKatmani = document.documentElement.hasAttribute('data-af-no-storage');

  if (!hasNative && !kendiKatmani) {
    var canPersist = (function () {
      try {
        var probe = PREFIX + '__test__';
        window.localStorage.setItem(probe, '1');
        window.localStorage.removeItem(probe);
        return true;
      } catch (e) {
        return false; // gizli sekme veya kısıtlı tarayıcı
      }
    })();

    // localStorage kapalıysa oturum boyunca bellekte tut (veri kalıcı olmaz)
    var mem = {};

    var readRaw = function (k) {
      if (canPersist) return window.localStorage.getItem(PREFIX + k);
      return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
    };
    var writeRaw = function (k, v) {
      if (!canPersist) { mem[k] = v; return; }
      try {
        window.localStorage.setItem(PREFIX + k, v);
      } catch (e) {
        // Kota aşımı: en sık sebep büyük dosya yüklemeleridir.
        console.error('[Artıfarma] Kayıt alanı doldu:', e);
        window.dispatchEvent(new CustomEvent('artifarma:quota-exceeded'));
        throw e;
      }
    };

    window.storage = {
      // İkinci parametre (paylaşımlı bayrağı) Claude ortamına aittir; burada göz ardı edilir.
      get: function (k) {
        var v = readRaw(k);
        return Promise.resolve(v === null ? null : { key: k, value: v });
      },
      set: function (k, v) {
        writeRaw(k, v);
        return Promise.resolve({ key: k, value: v });
      },
      delete: function (k) {
        if (canPersist) window.localStorage.removeItem(PREFIX + k);
        else delete mem[k];
        return Promise.resolve({ key: k, deleted: true });
      },
      list: function (p) {
        var keys = [];
        if (canPersist) {
          for (var i = 0; i < window.localStorage.length; i++) {
            var full = window.localStorage.key(i);
            if (full && full.indexOf(PREFIX) === 0) keys.push(full.slice(PREFIX.length));
          }
        } else {
          keys = Object.keys(mem);
        }
        if (p) keys = keys.filter(function (k) { return k.indexOf(p) === 0; });
        return Promise.resolve({ keys: keys });
      }
    };

    window.ARTIFARMA_STORAGE_MODE = canPersist ? 'local' : 'memory';
  } else {
    window.ARTIFARMA_STORAGE_MODE = kendiKatmani ? 'kendi' : 'cloud';
  }

  /* ---------- 2) Yedekleme yardımcıları ---------- */
  /* Veri tarayıcıda durduğu için düzenli yedek önemlidir.
     Araç sayfalarının kendi yedekleme düğmeleri vardır; bunlar
     tüm uygulamaları birlikte dışa aktarmak için kullanılabilir. */
  window.ArtifarmaBackup = {
    exportAll: async function () {
      var listed = await window.storage.list();
      var out = {};
      for (var i = 0; i < listed.keys.length; i++) {
        var k = listed.keys[i];
        var r = await window.storage.get(k, true);
        if (r && r.value != null) out[k] = r.value;
      }
      return { format: 'artifarma-backup', version: 1, date: new Date().toISOString(), data: out };
    },
    importAll: async function (obj) {
      if (!obj || obj.format !== 'artifarma-backup' || !obj.data) {
        throw new Error('Geçersiz yedek dosyası');
      }
      var keys = Object.keys(obj.data);
      for (var i = 0; i < keys.length; i++) {
        await window.storage.set(keys[i], obj.data[keys[i]], true);
      }
      return keys.length;
    }
  };


  /* ---------- 4) Eczane kimlik kartı ---------- */
  /* Bir eczane kaydı açıldığında giriş bilgilerini tek ve tanıdık bir
     ekranda gösterir. Amaç: danışmanın bilgileri kaçırmadan eczacıya
     iletebilmesi. Şifresini özetleyerek saklayan araçlarda bilgi
     yalnızca bu anda görülebilir, sonradan geri getirilemez.

     Kullanımı:
       ArtifarmaKimlik.goster({
         arac:'Danışman Kokpiti', baslik:'Naturel Eczanesi',
         satirlar:[{etiket:'Eczane ID',deger:'ECZ-4821'},
                   {etiket:'Şifre',deger:'k3m9xz'}],
         kalici:false,            // true → şifre sonradan da görülebilir
         not:'...'                // isteğe bağlı ek açıklama
       });                                                            */

  var KIMLIK_CSS =
    '.afk-ort{position:fixed;inset:0;background:rgba(20,20,45,.6);z-index:10000;' +
    'display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto;' +
    "font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif}" +
    '.afk-kart{background:#fff;border-radius:16px;max-width:460px;width:100%;' +
    'box-shadow:0 24px 70px rgba(0,0,0,.35);overflow:hidden;animation:afkAc .18s ease}' +
    '@keyframes afkAc{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}' +
    '.afk-bas{background:#2A2A5E;color:#fff;padding:20px 24px;display:flex;align-items:center;gap:12px}' +
    '.afk-bas img{height:22px;width:auto;display:block}' +
    '.afk-bas .afk-chip{background:#fff;border-radius:7px;padding:4px 8px;display:inline-flex;' +
    'align-items:center;flex:none}' +
    '.afk-bas b{font-size:15px;font-weight:800;letter-spacing:-.01em;display:block}' +
    '.afk-bas span{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;' +
    'color:#b9b9d6}' +
    '.afk-govde{padding:24px}' +
    '.afk-govde>h3{font-size:18px;color:#2A2A5E;margin:0 0 4px;font-weight:800;letter-spacing:-.02em}' +
    '.afk-govde>p.afk-alt{font-size:12.5px;color:#6b6f86;margin:0 0 18px}' +
    '.afk-satir{background:#F5F6FB;border:1px solid #E4E6F1;border-radius:10px;' +
    'padding:12px 15px;margin-bottom:9px;display:flex;align-items:center;justify-content:space-between;gap:12px}' +
    '.afk-satir .afk-et{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;' +
    'color:#6b6f86;display:block;margin-bottom:3px}' +
    '.afk-satir .afk-dg{font-size:18px;font-weight:800;color:#1c1c2e;letter-spacing:.04em;' +
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}' +
    '.afk-kopya{background:#EEF0F8;border:none;border-radius:8px;padding:7px 11px;cursor:pointer;' +
    'font-size:11.5px;font-weight:700;color:#2A2A5E;flex:none;font-family:inherit;transition:.14s}' +
    '.afk-kopya:hover{background:#e2e5f3}' +
    '.afk-uyari{background:#fdf6e6;border:1px solid #f0e0b5;color:#7a5c06;border-radius:10px;' +
    'padding:12px 15px;font-size:12.5px;line-height:1.55;margin:14px 0 0}' +
    '.afk-not{font-size:12.5px;color:#6b6f86;line-height:1.55;margin:14px 0 0}' +
    '.afk-ortak{background:#e9f7f0;border:1px solid #c4e8d8;color:#0d6b47;border-radius:10px;' +
    'padding:11px 14px;font-size:12.5px;line-height:1.5;margin:14px 0 0}' +
    '.afk-ayak{padding:16px 24px;border-top:1px solid #E4E6F1;background:#fafbfe;' +
    'display:flex;gap:9px;flex-wrap:wrap}' +
    '.afk-d{flex:1;min-width:120px;display:inline-flex;align-items:center;justify-content:center;gap:7px;' +
    'padding:11px 14px;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;border:1.5px solid transparent;' +
    'font-family:inherit;text-decoration:none;transition:.14s}' +
    '.afk-d1{background:#2A2A5E;color:#fff}.afk-d1:hover{background:#22224d}' +
    '.afk-d2{background:#fff;color:#2A2A5E;border-color:#E4E6F1}.afk-d2:hover{border-color:#2A2A5E}' +
    '@media(max-width:420px){.afk-d{min-width:100%}}';

  function kimlikStil() {
    if (document.getElementById('afk-stil')) return;
    var st = document.createElement('style');
    st.id = 'afk-stil';
    st.textContent = KIMLIK_CSS;
    document.head.appendChild(st);
  }

  function kimlikMetni(o) {
    var adres = location.origin && location.origin !== 'null'
      ? location.origin + location.pathname : '';
    var p = [];
    p.push('Sayın yetkili,');
    p.push('');
    p.push((o.baslik || 'Eczaneniz') + ' için ' + (o.arac || 'sistem') + ' giriş bilgileriniz:');
    p.push('');
    (o.satirlar || []).forEach(function (s) { p.push(s.etiket + ': ' + s.deger); });
    if (adres) { p.push(''); p.push('Giriş adresi: ' + adres); }
    p.push('');
    p.push('Artıfarma Group');
    return p.join('\n');
  }

  window.ArtifarmaKimlik = {
    goster: function (o) {
      o = o || {};
      kimlikStil();

      var metin = kimlikMetni(o);
      var ort = document.createElement('div');
      ort.className = 'afk-ort';

      var satirHtml = (o.satirlar || []).map(function (s, i) {
        return '<div class="afk-satir"><div><span class="afk-et">' + s.etiket + '</span>' +
               '<span class="afk-dg">' + s.deger + '</span></div>' +
               '<button class="afk-kopya" data-kop="' + i + '">Kopyala</button></div>';
      }).join('');

      ort.innerHTML =
        '<div class="afk-kart" role="dialog" aria-modal="true">' +
          '<div class="afk-bas">' +
            '<span class="afk-chip"><img src="assets/logo.png" alt="Artıfarma Group"></span>' +
            '<div><b>Giriş Bilgileri</b><span>' + (o.arac || '') + '</span></div>' +
          '</div>' +
          '<div class="afk-govde">' +
            '<h3>' + (o.baslik || '') + '</h3>' +
            '<p class="afk-alt">Aşağıdaki bilgileri eczaneyle paylaşın.</p>' +
            satirHtml +
            (o.kalici
              ? '<div class="afk-not">Bu bilgilere daha sonra eczane kaydından yeniden ulaşabilirsiniz.</div>'
              : '<div class="afk-uyari"><b>Şifreyi şimdi kaydedin.</b> Güvenlik gereği ' +
                'şifrelenmiş olarak saklanır ve bu ekran kapandıktan sonra bir daha gösterilemez.</div>') +
            (o.ortak ? '<div class="afk-ortak">Bu kimlik <b>tüm Artıfarma araçlarında</b> geçerlidir.</div>' : '') +
            (o.not ? '<div class="afk-not">' + o.not + '</div>' : '') +
          '</div>' +
          '<div class="afk-ayak">' +
            '<button class="afk-d afk-d1" data-hepsi>Bilgileri kopyala</button>' +
            '<a class="afk-d afk-d2" data-wa target="_blank" rel="noopener">WhatsApp</a>' +
            '<button class="afk-d afk-d2" data-kapat>Kapat</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(ort);

      ort.querySelector('[data-wa]').href = 'https://wa.me/?text=' + encodeURIComponent(metin);

      function kopyala(deger, dugme, etiket) {
        var bitir = function (ok) {
          dugme.textContent = ok ? 'Kopyalandı ✓' : 'Kopyalanamadı';
          setTimeout(function () { dugme.textContent = etiket; }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(deger).then(function () { bitir(true); },
                                                    function () { bitir(false); });
        } else {
          var t = document.createElement('textarea');
          t.value = deger; t.style.position = 'fixed'; t.style.left = '-9999px';
          document.body.appendChild(t); t.select();
          var ok = false;
          try { ok = document.execCommand('copy'); } catch (e) {}
          document.body.removeChild(t); bitir(ok);
        }
      }

      ort.querySelectorAll('[data-kop]').forEach(function (b) {
        b.onclick = function () {
          kopyala(o.satirlar[+b.dataset.kop].deger, b, 'Kopyala');
        };
      });
      ort.querySelector('[data-hepsi]').onclick = function () {
        kopyala(metin, this, 'Bilgileri kopyala');
      };

      function kapat() { if (ort.parentNode) ort.parentNode.removeChild(ort); }
      ort.querySelector('[data-kapat]').onclick = kapat;
      ort.addEventListener('click', function (e) { if (e.target === ort) kapat(); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { kapat(); document.removeEventListener('keydown', esc); }
      });
    }
  };


  /* ---------- 5) Ortak eczane kütüğü ---------- */
  /* Bir eczane, bütün Artıfarma araçlarında AYNI kimlikle açılsın diye
     ID ve şifre burada tutulur. Araçlar eczane kaydı oluştururken
     kendi rastgele kimliklerini üretmek yerine buradan ister.

     Kütük doğrudan localStorage'da durur; window.storage katmanına
     bağlı değildir, böylece kendi veri katmanı olan araçlarda da
     (data-af-no-storage) aynı şekilde çalışır.

     Kayıt: { id, ad, sifre, olusturma }                              */

  var KUTUK = PREFIX + 'ortak_eczaneler';
  var ABC = 'ABCDEFGHJKLMNPRSTUVYZ23456789';   // karışan harfler yok (O/0, I/1)

  function kutukOku() {
    try { return JSON.parse(window.localStorage.getItem(KUTUK) || '[]'); }
    catch (e) { return []; }
  }
  function kutukYaz(liste) {
    try { window.localStorage.setItem(KUTUK, JSON.stringify(liste)); return true; }
    catch (e) { console.error('[Artıfarma] Kütük yazılamadı:', e); return false; }
  }
  /* Eczane adlarını karşılaştırmak için sadeleştirir:
     "Naturel Eczanesi " ile "naturel  eczanesi" aynı sayılır. */
  function adAnahtari(ad) {
    return (ad || '').toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
  }
  function rastgele(uzunluk) {
    var s = '', i;
    if (window.crypto && window.crypto.getRandomValues) {
      var r = new Uint32Array(uzunluk);
      window.crypto.getRandomValues(r);
      for (i = 0; i < uzunluk; i++) s += ABC[r[i] % ABC.length];
    } else {
      for (i = 0; i < uzunluk; i++) s += ABC[Math.floor(Math.random() * ABC.length)];
    }
    return s;
  }

  window.ArtifarmaEczane = {
    liste: function () { return kutukOku(); },

    bul: function (id) {
      var a = (id || '').toUpperCase();
      return kutukOku().filter(function (k) { return k.id.toUpperCase() === a; })[0] || null;
    },

    bulAd: function (ad) {
      var a = adAnahtari(ad);
      return kutukOku().filter(function (k) { return adAnahtari(k.ad) === a; })[0] || null;
    },

    /* Bu ada kayıtlı eczane varsa onun kimliğini döndürür, yoksa yeni üretir.
       Dönüş: { id, sifre, ad, yeni }  →  yeni=true ise ilk kez oluşturuldu. */
    esle: function (ad) {
      var mevcut = this.bulAd(ad);
      if (mevcut) return { id: mevcut.id, sifre: mevcut.sifre, ad: mevcut.ad, yeni: false };

      var liste = kutukOku(), id;
      do { id = 'ECZ-' + rastgele(4); }
      while (liste.some(function (k) { return k.id === id; }));

      var kayit = { id: id, ad: (ad || '').trim(), sifre: rastgele(6), arsiv: false,
                    olusturma: new Date().toISOString() };
      liste.push(kayit);
      kutukYaz(liste);
      return { id: kayit.id, sifre: kayit.sifre, ad: kayit.ad, yeni: true };
    },

    /* Araç içinde şifre yenilendiğinde kütük de aynı değeri göstersin diye
       kullanılır; böylece kayıt merkezindeki liste hiç eskimez. */
    sifreAyarla: function (id, sifre) {
      var liste = kutukOku(), bulundu = null;
      liste.forEach(function (k) {
        if (k.id.toUpperCase() === (id || '').toUpperCase()) { k.sifre = sifre; bulundu = k; }
      });
      if (bulundu) kutukYaz(liste);
      return bulundu;
    },

    /* Danışmanın kendi belirlediği kimlikle kayıt açar/günceller.
       Dönüş: {tamam:true, kayit} ya da {tamam:false, hata:'...'}     */
    elleKaydet: function (ad, id, sifre, eskiId) {
      ad = (ad || '').trim();
      id = (id || '').trim().toUpperCase();
      sifre = (sifre || '').trim();
      if (!ad)               return { tamam: false, hata: 'Eczane adı gerekli.' };
      if (id.length < 3)     return { tamam: false, hata: 'Eczane ID en az 3 karakter olmalı.' };
      if (/[\s]/.test(id))   return { tamam: false, hata: 'Eczane ID boşluk içeremez.' };
      if (sifre.length < 4)  return { tamam: false, hata: 'Şifre en az 4 karakter olmalı.' };
      if (sifre.length > 8)  return { tamam: false, hata: 'Şifre en fazla 8 karakter olabilir.' };

      var liste = kutukOku();
      var carpisma = liste.filter(function (k) {
        return k.id.toUpperCase() === id &&
               (!eskiId || k.id.toUpperCase() !== String(eskiId).toUpperCase());
      })[0];
      if (carpisma) return { tamam: false, hata: 'Bu ID başka bir eczanede kullanılıyor.' };

      var mevcut = eskiId
        ? liste.filter(function (k) { return k.id.toUpperCase() === String(eskiId).toUpperCase(); })[0]
        : this.bulAd(ad);

      if (mevcut) { mevcut.ad = ad; mevcut.id = id; mevcut.sifre = sifre; }
      else {
        mevcut = { id: id, ad: ad, sifre: sifre, arsiv: false,
                   olusturma: new Date().toISOString() };
        liste.push(mevcut);
      }
      kutukYaz(liste);
      return { tamam: true, kayit: mevcut };
    },

    /* Kullanılabilir bir kimlik önerisi (form ilk açıldığında doldurulur). */
    oneri: function () {
      var liste = kutukOku(), id;
      do { id = 'ECZ-' + rastgele(4); }
      while (liste.some(function (k) { return k.id === id; }));
      return { id: id, sifre: rastgele(6) };
    },

    arsivle: function (id, deger) {
      var liste = kutukOku(), bulunan = null;
      liste.forEach(function (k) {
        if (k.id.toUpperCase() === (id || '').toUpperCase()) { k.arsiv = !!deger; bulunan = k; }
      });
      if (bulunan) kutukYaz(liste);
      return bulunan;
    },

    kaldir: function (id) {
      kutukYaz(kutukOku().filter(function (k) {
        return k.id.toUpperCase() !== (id || '').toUpperCase();
      }));
    },

    /* Var olan bir kaydın şifresini yeniler (tüm araçlar için geçerli olur). */
    sifreYenile: function (id) {
      var liste = kutukOku(), yeni = rastgele(6), bulundu = null;
      liste.forEach(function (k) {
        if (k.id.toUpperCase() === (id || '').toUpperCase()) { k.sifre = yeni; bulundu = k; }
      });
      if (bulundu) kutukYaz(liste);
      return bulundu;
    },

    /* Eczane adı forma yazılırken kayıtlı adları öneren liste.
       Aynı eczanenin yazım farkıyla ikinci kez açılmasını önler. */
    onerileriBagla: function (input) {
      if (!input || input.dataset.afOneri) return;
      var liste = kutukOku().filter(function (k) { return !k.arsiv; });
      if (!liste.length) return;
      var dl = document.createElement('datalist');
      dl.id = 'af-eczane-onerileri-' + Math.random().toString(36).slice(2, 7);
      liste.forEach(function (k) {
        var o = document.createElement('option');
        o.value = k.ad; o.label = k.id;
        dl.appendChild(o);
      });
      document.body.appendChild(dl);
      input.setAttribute('list', dl.id);
      input.dataset.afOneri = '1';
    }
  };


  /* ---------- 5b) Ortak çalışan kütüğü ---------- */
  /* Çalışanlar da eczaneler gibi tek yerden kaydedilir; böylece bir
     çalışan bütün Artıfarma araçlarında AYNI kullanıcı adı ve şifreyle
     giriş yapar. Araçlar bu kütüğü okuyup kendi çalışan kaydını KENDİ
     yapısıyla kurar — merkez hiçbir aracın şemasını taklit etmez.

     Kullanıcı adı kütük genelinde benzersizdir: iki ayrı eczanede aynı
     ada sahip iki çalışan olsa bile giriş bilgileri çakışmaz.

     Kayıt: { id, eczId, ad, pozisyon, kadi, sifre, olusturma, aktif }
     eczId = ortak eczane kütüğündeki ECZ-XXXX kimliği.                 */

  var CKUTUK = PREFIX + 'ortak_calisanlar';

  function cKutukOku() {
    try { return JSON.parse(window.localStorage.getItem(CKUTUK) || '[]'); }
    catch (e) { return []; }
  }
  function cKutukYaz(liste) {
    try { window.localStorage.setItem(CKUTUK, JSON.stringify(liste)); return true; }
    catch (e) { console.error('[Artıfarma] Çalışan kütüğü yazılamadı:', e); return false; }
  }

  /* Türkçe adı kullanıcı adına çevirir: "Ayşe Yılmaz" → "ayse.yilmaz".
     Araçların tamamı [a-z0-9._-] beklediği için harfler sadeleştirilir. */
  var TR_HARF = { 'ı':'i','İ':'i','ş':'s','Ş':'s','ğ':'g','Ğ':'g',
                  'ü':'u','Ü':'u','ö':'o','Ö':'o','ç':'c','Ç':'c','â':'a','î':'i','û':'u' };
  function kadiSade(ad) {
    var s = (ad || '').replace(/[ıİşŞğĞüÜöÖçÇâîû]/g, function (c) { return TR_HARF[c] || c; });
    return s.toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  }
  function kadiUret(ad, kullanilan) {
    var taban = kadiSade(ad);
    if (taban.length < 3) taban = (taban ? taban + '.' : '') + 'calisan';
    if (taban.length > 24) taban = taban.slice(0, 24).replace(/\.+$/, '');
    var k = taban, n = 1;
    while (kullanilan.indexOf(k) >= 0) { n++; k = taban + n; }
    return k;
  }
  function cKopya(k, yeni) {
    return { id: k.id, eczId: k.eczId, ad: k.ad, pozisyon: k.pozisyon,
             kadi: k.kadi, sifre: k.sifre, olusturma: k.olusturma,
             aktif: k.aktif !== false, yeni: !!yeni };
  }

  window.ArtifarmaCalisan = {
    /* eczId verilmezse bütün kütük döner. */
    liste: function (eczId) {
      var l = cKutukOku();
      if (!eczId) return l;
      var a = String(eczId).toUpperCase();
      return l.filter(function (c) { return String(c.eczId).toUpperCase() === a; });
    },

    bul: function (id) {
      return cKutukOku().filter(function (c) { return c.id === id; })[0] || null;
    },

    bulKadi: function (kadi) {
      var a = (kadi || '').toLowerCase();
      return cKutukOku().filter(function (c) { return c.kadi === a; })[0] || null;
    },

    bulAd: function (eczId, ad) {
      var e = String(eczId).toUpperCase(), a = adAnahtari(ad);
      return cKutukOku().filter(function (c) {
        return String(c.eczId).toUpperCase() === e && adAnahtari(c.ad) === a;
      })[0] || null;
    },

    /* Aynı eczanede aynı ada kayıt varsa onu döndürür (yeni=false),
       yoksa kimlik + şifre üretip ekler (yeni=true). */
    ekle: function (eczId, bilgi) {
      bilgi = bilgi || {};
      var mevcut = this.bulAd(eczId, bilgi.ad);
      if (mevcut) return cKopya(mevcut, false);

      var l = cKutukOku(), id;
      do { id = 'PRS-' + rastgele(4); }
      while (l.some(function (c) { return c.id === id; }));

      var kayit = {
        id: id, eczId: String(eczId).toUpperCase(),
        ad: (bilgi.ad || '').trim(), pozisyon: (bilgi.pozisyon || '').trim(),
        kadi: kadiUret(bilgi.ad, l.map(function (c) { return c.kadi; })),
        sifre: rastgele(6), olusturma: new Date().toISOString(), aktif: true
      };
      l.push(kayit);
      cKutukYaz(l);
      return cKopya(kayit, true);
    },

    /* Araçlar çağırır: kullanıcı adı araç içinde çakıştıysa merkez
       kaydı da düzeltilir; kütük ile araç hep aynı bilgiyi gösterir. */
    guncelle: function (id, alanlar) {
      var l = cKutukOku(), bulundu = null;
      l.forEach(function (c) {
        if (c.id !== id) return;
        bulundu = c;
        ['ad', 'pozisyon', 'kadi', 'aktif'].forEach(function (a) {
          if (alanlar && alanlar[a] !== undefined) c[a] = alanlar[a];
        });
      });
      if (bulundu) cKutukYaz(l);
      return bulundu ? cKopya(bulundu, false) : null;
    },

    /* Araç içinde şifre yenilendiğinde kütüğe de yazılır. */
    sifreAyarla: function (id, sifre) {
      var l = cKutukOku(), bulundu = null;
      l.forEach(function (c) { if (c.id === id) { c.sifre = sifre; bulundu = c; } });
      if (bulundu) cKutukYaz(l);
      return bulundu ? cKopya(bulundu, false) : null;
    },

    sifreYenile: function (id) {
      var l = cKutukOku(), yeni = rastgele(6), bulundu = null;
      l.forEach(function (c) { if (c.id === id) { c.sifre = yeni; bulundu = c; } });
      if (bulundu) cKutukYaz(l);
      return bulundu ? cKopya(bulundu, false) : null;
    },

    sil: function (id) {
      cKutukYaz(cKutukOku().filter(function (c) { return c.id !== id; }));
    },

    /* Eczane kütükten çıkarıldığında çalışanları da düşer. */
    eczaneSil: function (eczId) {
      var a = String(eczId).toUpperCase();
      cKutukYaz(cKutukOku().filter(function (c) {
        return String(c.eczId).toUpperCase() !== a;
      }));
    }
  };


  /* ---------- 6) Merkezi eczane kurulumu (kuyruk) ---------- */
  /* eczaneler.html'de bir eczane kaydedildiğinde, hangi araçlarda
     açılacağı buraya bir "iş emri" olarak yazılır. Her araç açıldığında
     kendine düşen emirleri görür ve kaydı KENDİ fabrika koduyla oluşturur.

     Neden böyle: araçların eczane kayıtları birbirinden çok farklı
     (finans kaydı kategoriler, tedarikçiler, gider kalemleri içerir).
     Merkezî sayfa bu yapıları taklit etseydi, araç Claude'da yeniden
     üretildiğinde bozulurdu. Kuyruk sayesinde yapıyı hep aracın kendisi
     kurar; merkez yalnızca ad ve kimliği söyler.

     Emir: { id, ad, sehir, eczaci, sifre, tarih, kurulan:{arac:true} }   */

  var KUYRUK = PREFIX + 'kurulum_kuyrugu';

  function kuyrukOku() {
    try { return JSON.parse(window.localStorage.getItem(KUYRUK) || '[]'); }
    catch (e) { return []; }
  }
  function kuyrukYaz(l) {
    try { window.localStorage.setItem(KUYRUK, JSON.stringify(l)); return true; }
    catch (e) { console.error('[Artıfarma] Kuyruk yazılamadı:', e); return false; }
  }

  window.ArtifarmaKurulum = {
    ARACLAR: ['program', 'yetkinlik', 'swot', 'finans', 'performans'],

    liste: function () { return kuyrukOku(); },

    /* Merkezî sayfa çağırır: eczanenin kaydını araçlardan sildirir.
       Silmeyi her araç kendi koduyla yapar. */
    sildir: function (kayit, araclar) {
      return this.yeniIs(kayit, araclar, 'sil');
    },

    /* Arşive alma / arşivden çıkarma; araçlar listelerinden gizler. */
    arsivle: function (kayit, araclar, deger) {
      var v = this.yeniIs(kayit, araclar, 'arsiv');
      var l = kuyrukOku();
      l.forEach(function (x) { if (x.id === v.id) x.arsivDeger = !!deger; });
      kuyrukYaz(l);
      return v;
    },

    /* Eşitleme ve silme, daha önce kurulmuş araçlar için de YENİ bir iştir;
       bu yüzden ilgili araçların "kuruldu" bayrağı sıfırlanır. Aksi hâlde
       emir, kaydı zaten olan araçlara hiç ulaşmaz. */
    yeniIs: function (kayit, araclar, islem) {
      var v = this.sirala(kayit, araclar);
      var hedef = araclar || this.ARACLAR;
      var l = kuyrukOku();
      l.forEach(function (x) {
        if (x.id !== v.id) return;
        x.islem = islem;                       // eski sürümlerle uyum
        hedef.forEach(function (a) {
          /* Henüz kurulmamış bir araçta bekleyen "kur" işi korunur:
             kurulum zaten güncel kimlikle yapılacağı için eşitlemeye gerek yok.
             Silme ve arşiv ise her durumda geçerlidir. */
          if (x.kurulan[a] === 'kur' && islem === 'esle') return;
          x.kurulan[a] = islem;
        });
      });
      kuyrukYaz(l);
      return v;
    },

    /* Merkezî sayfa çağırır: VAR OLAN bir eczanenin kimliğini ortak
       kimliğe çekmesi için araçlara emir bırakır. Araç, kaydını adından
       bulup kendi koduyla günceller (finans şifreyi kendi özetler). */
    esitle: function (kayit, araclar) {
      return this.yeniIs(kayit, araclar, 'esle');
    },

    /* Merkezî sayfa çağırır: eczaneyi seçilen araçlar için sıraya koyar. */
    sirala: function (kayit, araclar) {
      var l = kuyrukOku();
      var v = l.filter(function (x) { return x.id === kayit.id; })[0];
      if (!v) {
        v = { id: kayit.id, ad: kayit.ad, sehir: kayit.sehir || '',
              eczaci: kayit.eczaci || '', sifre: kayit.sifre,
              tarih: new Date().toISOString(), kurulan: {} };
        l.push(v);
      } else {
        v.ad = kayit.ad; v.sehir = kayit.sehir || ''; v.eczaci = kayit.eczaci || '';
        v.sifre = kayit.sifre;
      }
      (araclar || this.ARACLAR).forEach(function (a) {
        /* Bekleyen bir iş varsa korunur; yoksa kurulum sırasına alınır. */
        if (v.kurulan[a] === undefined || v.kurulan[a] === false) v.kurulan[a] = 'kur';
      });
      kuyrukYaz(l);
      return v;
    },

    /* Araç çağırır: kendisi için bekleyen emirler. */
    bekleyenler: function (arac, islem) {
      var hedef = islem || 'kur';
      return kuyrukOku().filter(function (x) {
        var d = x.kurulan[arac];
        if (d === false) d = 'kur';            // eski kayıtlarla uyum
        return d === hedef;
      });
    },

    /* Araç, kaydı oluşturduktan sonra çağırır. */
    tamamlandi: function (arac, id) {
      var l = kuyrukOku(), degisti = false;
      l.forEach(function (x) {
        if (x.id !== id) return;
        if (x.kurulan[arac] !== true) { x.kurulan[arac] = true; degisti = true; }
      });
      if (degisti) kuyrukYaz(l);
      return degisti;
    },

    /* Merkezî sayfa için durum özeti. */
    durum: function (id) {
      var v = kuyrukOku().filter(function (x) { return x.id === id; })[0];
      return v ? v.kurulan : {};
    },

    sil: function (id) {
      kuyrukYaz(kuyrukOku().filter(function (x) { return x.id !== id; }));
    }
  };


  /* ---------- 7) Gelen kayıtlar (öz değerlendirme / danışmanlık talebi) ---------- */
  /* Siteden gelen iletişim bilgileri iki AYRI defterde tutulur.

     ÖNEMLİ: Ziyaretçi formu kendi cihazında doldurur; kayıt o tarayıcıya
     yazılır. Danışmanın panelinde görünmesi için kayıt ayrıca Netlify form
     servisine gönderilir (analiz.html / iletisim.html bunu yapar) ve oradan
     CSV olarak panele alınır. Bu defter, danışmanın kendi cihazında girilen
     kayıtlar ile içe aktarılanları birlikte tutar.                        */

  var DEFTER = { analiz: PREFIX + 'kayit_analiz', talep: PREFIX + 'kayit_talep' };

  function defterOku(tur) {
    try { return JSON.parse(window.localStorage.getItem(DEFTER[tur]) || '[]'); }
    catch (e) { return []; }
  }
  function defterYaz(tur, l) {
    try { window.localStorage.setItem(DEFTER[tur], JSON.stringify(l)); return true; }
    catch (e) { console.error('[Artıfarma] Kayıt yazılamadı:', e); return false; }
  }
  /* Aynı kaydın iki kez girmesini önler: e-posta + tarih gününe bakar. */
  function kayitAnahtari(k) {
    return ((k['E-posta'] || '') + '|' + (k['Ad Soyad'] || '') + '|' +
            String(k.tarih || '').slice(0, 10)).toLocaleLowerCase('tr-TR');
  }

  window.ArtifarmaKayit = {
    TURLER: { analiz: 'Öz Değerlendirme', talep: 'Danışmanlık Talebi' },

    liste: function (tur) { return defterOku(tur); },

    ekle: function (tur, veri) {
      var l = defterOku(tur);
      var k = Object.assign({}, veri);
      if (!k.tarih) k.tarih = new Date().toISOString();
      if (!k.kaynak) k.kaynak = 'site';
      var anahtar = kayitAnahtari(k);
      if (l.some(function (x) { return kayitAnahtari(x) === anahtar; })) return null;
      l.push(k);
      defterYaz(tur, l);
      return k;
    },

    sil: function (tur, tarih) {
      defterYaz(tur, defterOku(tur).filter(function (x) { return x.tarih !== tarih; }));
    },

    temizle: function (tur) { defterYaz(tur, []); },

    /* Netlify'dan indirilen CSV'yi defterle birleştirir; tekrarlar atlanır. */
    csvAl: function (tur, metin) {
      var satirlar = this.csvCoz(metin);
      if (!satirlar.length) return { eklenen: 0, atlanan: 0 };
      var l = defterOku(tur), eklenen = 0, atlanan = 0;
      satirlar.forEach(function (r) {
        r.kaynak = 'netlify';
        if (!r.tarih) r.tarih = r['Date'] || r['date'] || new Date().toISOString();
        var a = kayitAnahtari(r);
        if (l.some(function (x) { return kayitAnahtari(x) === a; })) { atlanan++; return; }
        l.push(r); eklenen++;
      });
      defterYaz(tur, l);
      return { eklenen: eklenen, atlanan: atlanan };
    },

    /* Tırnak içindeki virgül ve satır sonlarını da doğru çözer. */
    csvCoz: function (metin) {
      var hucreler = [], satir = [], h = '', tirnak = false, i, c;
      metin = String(metin).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      for (i = 0; i < metin.length; i++) {
        c = metin[i];
        if (tirnak) {
          if (c === '"' && metin[i + 1] === '"') { h += '"'; i++; }
          else if (c === '"') tirnak = false;
          else h += c;
        } else if (c === '"') tirnak = true;
        else if (c === ',') { satir.push(h); h = ''; }
        else if (c === '\n') { satir.push(h); hucreler.push(satir); satir = []; h = ''; }
        else h += c;
      }
      if (h !== '' || satir.length) { satir.push(h); hucreler.push(satir); }
      if (hucreler.length < 2) return [];
      var basliklar = hucreler[0].map(function (x) { return x.trim(); });
      return hucreler.slice(1)
        .filter(function (r) { return r.some(function (x) { return String(x).trim(); }); })
        .map(function (r) {
          var o = {};
          basliklar.forEach(function (b, j) { if (b) o[b] = (r[j] || '').trim(); });
          return o;
        });
    },

    csvVer: function (tur) {
      var l = defterOku(tur);
      if (!l.length) return '';
      var sutunlar = [];
      l.forEach(function (k) {
        Object.keys(k).forEach(function (a) { if (sutunlar.indexOf(a) < 0) sutunlar.push(a); });
      });
      var kacir = function (v) {
        v = v == null ? '' : String(v);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      };
      return sutunlar.join(',') + '\n' +
        l.map(function (k) { return sutunlar.map(function (a) { return kacir(k[a]); }).join(','); }).join('\n');
    }
  };


  /* ---------- 8) Eczane bazlı erişim yetkileri ---------- */
  /* Hangi aracı kimin açabileceği eczane kaydında tutulur:

       yetki: { program:'eczaci', performans:'rapor', finans:'kapali', ... }

     Değerler:
       'kapali' → o eczane bu aracı hiç kullanmaz
       'eczaci' → yalnızca eczacı (yönetici) girebilir
       'rapor'  → eczacı tam görür, personel yalnızca rapor görür
       'tam'    → eczacı ve personel tam görür

     Araçlar girişte ArtifarmaYetki.izin(eczId, arac, rol) sorar;
     rol: 'eczaci' | 'personel'. Dönüş: 'tam' | 'rapor' | 'yok'.     */

  var YETKI_VARSAYILAN = 'tam';

  /* Bu araçlar yapıları gereği yalnızca danışman ve eczacı içindir;
     eczane personeli hiçbir ayarla giremez. Kokpit danışmanlık programını,
     Finans ise eczanenin mali verisini taşır. */
  var SADECE_ECZACI = ['program', 'finans'];

  function yetkiOku(eczId) {
    var k = window.ArtifarmaEczane ? window.ArtifarmaEczane.bul(eczId) : null;
    return (k && k.yetki) ? k.yetki : {};
  }

  var SECENEK_ECZACI = [
    { deger: 'kapali', ad: 'Kapalı' },
    { deger: 'eczaci', ad: 'Eczacı (personele kapalı)' }
  ];

  window.ArtifarmaYetki = {
    SECENEKLER: [
      { deger: 'kapali', ad: 'Kapalı' },
      { deger: 'eczaci', ad: 'Yalnızca eczacı' },
      { deger: 'rapor',  ad: 'Eczacı tam · personel yalnızca rapor' },
      { deger: 'tam',    ad: 'Eczacı ve personel tam' }
    ],

    oku: function (eczId) { return yetkiOku(eczId); },

    /* Bir aracın o eczane için ayarı; tanımsızsa varsayılan. */
    ayar: function (eczId, arac) {
      var y = yetkiOku(eczId);
      return y[arac] || YETKI_VARSAYILAN;
    },

    yaz: function (eczId, arac, deger) {
      if (!window.ArtifarmaEczane) return false;
      var liste = window.ArtifarmaEczane.liste(), yazildi = false;
      liste.forEach(function (k) {
        if (k.id.toUpperCase() !== String(eczId).toUpperCase()) return;
        if (!k.yetki) k.yetki = {};
        k.yetki[arac] = deger;
        yazildi = true;
      });
      if (yazildi) {
        try { window.localStorage.setItem(PREFIX + 'ortak_eczaneler', JSON.stringify(liste)); }
        catch (e) { return false; }
      }
      return yazildi;
    },

    /* Araçlar bunu sorar. */
    /* Araç yalnızca eczacıya mı açık? */
    sadeceEczaci: function (arac) { return SADECE_ECZACI.indexOf(arac) >= 0; },

    izin: function (eczId, arac, rol) {
      /* Arşivdeki eczane hiçbir araca giremez. */
      var kayit = window.ArtifarmaEczane ? window.ArtifarmaEczane.bul(eczId) : null;
      if (kayit && kayit.arsiv) return 'yok';
      var a = this.ayar(eczId, arac);
      if (a === 'kapali') return 'yok';
      if (rol === 'eczaci') return 'tam';          // eczacı, kapalı değilse tam görür
      if (this.sadeceEczaci(arac)) return 'yok';   // personele kapalı — ayardan bağımsız
      if (a === 'eczaci')   return 'yok';
      if (a === 'rapor')    return 'rapor';
      return 'tam';
    },

    /* Kayıt ekranında o araç için sunulacak seçenekler. */
    secenekler: function (arac) {
      return this.sadeceEczaci(arac)
        ? SECENEK_ECZACI
        : this.SECENEKLER;
    },

    /* Girişi reddedilen kullanıcıya gösterilecek açıklama. */
    mesaj: function (rol) {
      return rol === 'eczaci'
        ? 'Bu araç eczaneniz için kapalı. Danışmanınıza başvurun.'
        : 'Bu araca erişim yetkiniz yok. Eczacınıza veya danışmanınıza başvurun.';
    }
  };


  /* ---------- 9) Ortak pozisyon sözlüğü ---------- */
  /* Çalışan pozisyonu merkezde TEK bir listeden seçilir; her araç kendi
     rol adlandırmasını kullandığı için eşleme burada tutulur. Böylece
     aynı kişiye her araçta pozisyonuna uygun sorular gelir.

     Araç karşılıkları:
       swot       → ROLES anahtarı (eczaci, ikinci_eczaci, ...)
       yetkinlik  → ROLES dizisindeki metin
       performans → ROL_TOHUM kodu (yardimci, dermo, teknisyen, cirak)      */

  var POZISYONLAR = [
    { kod:'eczaci',          ad:'Eczacı',
      swot:'eczaci',          yetkinlik:'Eczacı',                 performans:'yardimci', yonetici:true },
    { kod:'ikinci_eczaci',   ad:'İkinci Eczacı',
      swot:'ikinci_eczaci',   yetkinlik:'İkinci Eczacı',          performans:'yardimci' },
    { kod:'yardimci_eczaci', ad:'Yardımcı Eczacı',
      swot:'yardimci_eczaci', yetkinlik:'Yardımcı Eczacı',        performans:'yardimci' },
    { kod:'teknisyen',       ad:'Eczane Teknisyeni',
      swot:'teknisyen',       yetkinlik:'Eczane Teknisyeni',      performans:'teknisyen' },
    { kod:'dermokozmetik',   ad:'Dermokozmetik Uzmanı',
      swot:'dermokozmetik',   yetkinlik:'Dermokozmetik Uzmanı',   performans:'dermo' },
    { kod:'cirak',           ad:'Çırak',
      swot:'cirak',           yetkinlik:'Eczane Çırağı / Yardımcı', performans:'cirak' }
  ];

  window.ArtifarmaPozisyon = {
    liste: function () { return POZISYONLAR.slice(); },

    bul: function (kod) {
      return POZISYONLAR.filter(function (p) { return p.kod === kod; })[0] || null;
    },

    /* Serbest yazılmış bir pozisyon metnini kanonik koda çevirir;
       eski kayıtlar ve araçlardan gelen adlar için. */
    coz: function (metin) {
      var m = (metin || '').toLocaleLowerCase('tr-TR').trim();
      if (!m) return null;
      var tam = POZISYONLAR.filter(function (p) {
        return p.kod === m || p.ad.toLocaleLowerCase('tr-TR') === m
            || String(p.yetkinlik).toLocaleLowerCase('tr-TR') === m;
      })[0];
      if (tam) return tam;
      /* Kısmi eşleme: "ecz. teknisyeni", "dermo uzmanı" gibi yazımlar */
      if (m.indexOf('ikinci') >= 0)                      return this.bul('ikinci_eczaci');
      if (m.indexOf('yardımcı ecz') >= 0)                return this.bul('yardimci_eczaci');
      if (m.indexOf('teknisyen') >= 0 || m.indexOf('teknik') >= 0) return this.bul('teknisyen');
      if (m.indexOf('dermo') >= 0)                       return this.bul('dermokozmetik');
      if (m.indexOf('çırak') >= 0 || m.indexOf('cirak') >= 0)      return this.bul('cirak');
      if (m.indexOf('eczacı') >= 0)                      return this.bul('eczaci');
      return null;
    },

    /* Bir araç için karşılığı verir; eşleşme yoksa aracın kendi
       varsayılanına düşsün diye null döner. */
    arac: function (kod, arac) {
      var p = this.bul(kod) || this.coz(kod);
      return p ? (p[arac] || null) : null;
    },

    /* <select> için seçenek listesi. */
    secenekler: function (secili) {
      return POZISYONLAR.map(function (p) {
        return '<option value="' + p.kod + '"' +
               (p.kod === secili ? ' selected' : '') + '>' + p.ad + '</option>';
      }).join('');
    }
  };


  /* ---------- 10) Hareketsizlik kilidi ---------- */
  /* Araçlar oturumu sekme kapanana kadar hatırlar; bu, eczanede açık
     bırakılan bir bilgisayarda riskli olur. Belirli süre işlem yapılmazsa
     oturum kapatılır ve giriş ekranı gelir.

     Süre: <html data-af-kilit="20"> ile sayfa bazında değiştirilebilir,
     0 yazılırsa kilit devre dışı kalır.                                  */

  var KILIT_DK = 30;

  function kilitKur() {
    var ozel = document.documentElement.getAttribute('data-af-kilit');
    var dk = ozel === null ? KILIT_DK : parseFloat(ozel);
    if (!dk || dk <= 0) return;                 // kapalı

    /* Oturumu olmayan sayfalarda (giriş ekranı) kilide gerek yok. */
    var sure = dk * 60 * 1000, zaman;

    function kilitle() {
      var vardi = false;
      try {
        vardi = window.sessionStorage.length > 0;
        window.sessionStorage.clear();
      } catch (e) { return; }
      if (!vardi) return;                       // zaten giriş yapılmamış
      try {
        window.localStorage.setItem(PREFIX + 'kilit_bildirim', '1');
      } catch (e) {}
      location.reload();
    }

    function sifirla() { clearTimeout(zaman); zaman = setTimeout(kilitle, sure); }

    ['mousedown', 'keydown', 'touchstart', 'scroll', 'focus']
      .forEach(function (o) { document.addEventListener(o, sifirla, true); });
    sifirla();

    /* Kilitlendikten sonraki ilk açılışta sebebini söyle. */
    try {
      if (window.localStorage.getItem(PREFIX + 'kilit_bildirim')) {
        window.localStorage.removeItem(PREFIX + 'kilit_bildirim');
        setTimeout(function () {
          var u = document.createElement('div');
          u.textContent = 'Uzun süre işlem yapılmadığı için oturum kapatıldı.';
          u.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:16px;' +
            'background:#2A2A5E;color:#fff;padding:11px 20px;border-radius:24px;z-index:10001;' +
            "font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-size:13px;font-weight:700;" +
            'box-shadow:0 8px 26px rgba(20,20,50,.3)';
          document.body.appendChild(u);
          setTimeout(function () { u.remove(); }, 5000);
        }, 400);
      }
    } catch (e) {}
  }

  /* ---------- 3) Araç sayfalarına dönüş düğmesi ---------- */
  /* Üç uygulama da tam ekran çalışır ve kendi başlık çubuğuna sahiptir.
     Düzenlerini bozmamak için gezinme, köşede duran ince bir düğme
     olarak eklenir. data-af-no-back özniteliği ile kapatılabilir. */
  /* Stil buraya gömülüdür: araç sayfalarının kendi CSS'i vardır ve
     ortak theme.css yüklenirse .btn/.card gibi sınıflar çakışır. */
  var BACK_CSS =
    '.af-back{position:fixed;left:16px;bottom:16px;z-index:9999;' +
    'display:inline-flex;align-items:center;gap:8px;' +
    'padding:9px 15px 9px 12px;border-radius:30px;' +
    'background:#2A2A5E;color:#fff;text-decoration:none;' +
    "font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-size:12.5px;font-weight:700;" +
    'box-shadow:0 6px 22px rgba(20,20,50,.32);' +
    'border:1px solid rgba(255,255,255,.14);transition:.16s}' +
    '.af-back:hover{background:#22224d;transform:translateY(-1px)}' +
    '.af-back svg{width:13px;height:13px;flex-shrink:0}' +
    '@media print{.af-back{display:none!important}}';

  function mountBackButton() {
    if (document.documentElement.hasAttribute('data-af-no-back')) return;
    if (document.querySelector('.af-back')) return;

    var style = document.createElement('style');
    style.textContent = BACK_CSS;
    document.head.appendChild(style);

    var a = document.createElement('a');
    a.className = 'af-back';
    a.href = 'index.html#araclar';
    a.title = 'Artıfarma araç merkezine dön';
    a.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M10 13 5 8l5-5"/></svg><span>Araçlar</span>';
    document.body.appendChild(a);
  }

  function baslat() { mountBackButton(); kilitKur(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', baslat);
  } else {
    baslat();
  }
})();
