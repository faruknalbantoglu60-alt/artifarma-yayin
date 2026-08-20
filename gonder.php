<?php
/* =====================================================================
   ARTIFARMA — Form işleyici

   iletisim.html ve analiz.html formlarını alır, size e-posta atar ve
   her kaydı web kökünün DIŞINDAKİ bir CSV dosyasına yazar.

   E-posta gitmese bile CSV'ye yazıldığı için hiçbir talep kaybolmaz.
   CSV, kayitlar.html panelindeki "CSV yükle" düğmesiyle içe aktarılabilir.

   Kurulum: ALICI satırındaki adresi kendi adresinizle değiştirin.
   ===================================================================== */

declare(strict_types=1);

/* ---- ayarlar ------------------------------------------------------ */

const ALICI          = 'faruk@artifarma360.com';  // talepler buraya düşer
const SAATLIK_SINIR  = 6;      // aynı IP'den saatte kaç gönderim
const ALAN_SINIRI    = 2000;   // tek alanda en fazla karakter
const KONTROL_ANAHTARI = '';   // doldurursanız ?kontrol=... teşhis sayfası açılır

/* Hangi form hangi alanları taşır. Sıralama CSV sütun sırasıdır. */
$FORMLAR = [
    'danismanlik' => [
        'tur'     => 'talep',
        'baslik'  => 'Danışmanlık talebi',
        'alanlar' => ['Ad Soyad', 'Telefon', 'E-posta', 'Eczane Adı',
                      'İl', 'Çalışan Sayısı', 'Not', 'KVKK Onayı'],
    ],
    'analiz-talep' => [
        'tur'     => 'analiz',
        'baslik'  => 'Öz değerlendirme talebi',
        'alanlar' => ['Ad Soyad', 'E-posta', 'Telefon', 'Eczane Adı',
                      'İl', 'KVKK Onayı'],
    ],
];

/* ---- yardımcılar -------------------------------------------------- */

/** Web kökünün dışındaki kayıt klasörü; yoksa oluşturulur. */
function kayitDizini(): ?string {
    $d = dirname(__DIR__) . '/talepler';
    if (!is_dir($d) && !@mkdir($d, 0750, true) && !is_dir($d)) return null;
    return is_writable($d) ? $d : null;
}

/** Satır sonu ve kontrol karakterlerini temizler, uzunluğu sınırlar. */
function temizle(string $s): string {
    $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $s) ?? '';
    return mb_substr(trim($s), 0, ALAN_SINIRI);
}

/** Başlık satırlarına kaçış karakteri sızmasını engeller. */
function basligaUygun(string $s): string {
    return trim(str_replace(["\r", "\n", "\0"], ' ', $s));
}

/** Türkçe karakterli konu başlığını e-posta standardına çevirir. */
function konuKodla(string $s): string {
    return '=?UTF-8?B?' . base64_encode(basligaUygun($s)) . '?=';
}

/**
 * PHP, $_POST anahtarlarındaki boşluğu ve noktayı alt çizgiye çevirir
 * ("Ad Soyad" -> "Ad_Soyad"). Alan adlarımız boşluklu olduğu için gövdeyi
 * kendimiz ayrıştırıyoruz; böylece anahtarlar birebir korunur.
 */
function gelenVeri(): array {
    $tur = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
    if (strpos($tur, 'application/x-www-form-urlencoded') === false) return $_POST;
    $ham = file_get_contents('php://input');
    if ($ham === false || $ham === '') return $_POST;
    $sonuc = [];
    foreach (explode('&', $ham) as $parca) {
        if ($parca === '') continue;
        $p  = explode('=', $parca, 2);
        $ad = urldecode($p[0]);
        if ($ad === '') continue;
        $sonuc[$ad] = isset($p[1]) ? urldecode($p[1]) : '';
    }
    return $sonuc;
}

function istemciIp(): string {
    return (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

/** Aynı IP saatte SAATLIK_SINIR defadan fazla gönderemez. */
function sinirAsildi(?string $dizin): bool {
    if ($dizin === null) return false;
    $dosya = $dizin . '/hiz-' . substr(hash('sha256', istemciIp()), 0, 16) . '.json';
    $simdi = time();
    $kayit = [];
    if (is_file($dosya)) {
        $ham = json_decode((string)@file_get_contents($dosya), true);
        if (is_array($ham)) $kayit = $ham;
    }
    $kayit = array_values(array_filter($kayit, fn($t) => is_int($t) && $t > $simdi - 3600));
    if (count($kayit) >= SAATLIK_SINIR) return true;
    $kayit[] = $simdi;
    @file_put_contents($dosya, json_encode($kayit), LOCK_EX);
    return false;
}

/** Kaydı CSV'ye ekler; dosya yeni ise başlık satırını ve BOM'u yazar. */
function csvYaz(?string $dizin, string $tur, array $sutunlar, array $satir): bool {
    if ($dizin === null) return false;
    $dosya = $dizin . '/' . $tur . '.csv';
    $yeni  = !is_file($dosya);
    $fp    = @fopen($dosya, 'a');
    if ($fp === false) return false;
    if (!flock($fp, LOCK_EX)) { fclose($fp); return false; }
    if ($yeni) {
        fwrite($fp, "\xEF\xBB\xBF");                 // Excel'in UTF-8 görmesi için
        fputcsv($fp, array_merge(['tarih'], $sutunlar), ',', '"', '');
    }
    fputcsv($fp, $satir, ',', '"', '');
    flock($fp, LOCK_UN);
    fclose($fp);
    return true;
}

function cikis(int $kod, string $mesaj): never {
    http_response_code($kod);
    header('Content-Type: text/plain; charset=UTF-8');
    echo $mesaj;
    exit;
}

/* ---- teşhis (isteğe bağlı) ---------------------------------------- */

if (KONTROL_ANAHTARI !== '' && ($_GET['kontrol'] ?? '') === KONTROL_ANAHTARI) {
    $d = kayitDizini();
    header('Content-Type: text/plain; charset=UTF-8');
    echo "PHP sürümü      : " . PHP_VERSION . "\n";
    echo "mail() var mı   : " . (function_exists('mail') ? 'evet' : 'HAYIR') . "\n";
    echo "Kayıt klasörü   : " . ($d ?? 'YAZILAMIYOR — ' . dirname(__DIR__) . '/talepler') . "\n";
    echo "Alıcı adres     : " . ALICI . "\n";
    echo "Gönderen alan   : " . preg_replace('/^www\./', '', (string)($_SERVER['HTTP_HOST'] ?? '')) . "\n";
    exit;
}

/* ---- ana akış ------------------------------------------------------ */

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    cikis(405, 'Yalnızca POST kabul edilir.');
}

$GELEN = gelenVeri();

/* Bot tuzağı: gizli alan doldurulmuşsa sessizce başarılı görün. */
if (temizle((string)($GELEN['dolduma'] ?? '')) !== '') {
    cikis(200, 'Alındı.');
}

$formAdi = (string)($GELEN['form-name'] ?? '');
if (!isset($FORMLAR[$formAdi])) {
    cikis(400, 'Form tanınmadı.');
}
$form = $FORMLAR[$formAdi];

/* Alanları topla */
$veri = [];
foreach ($form['alanlar'] as $alan) {
    $veri[$alan] = temizle((string)($GELEN[$alan] ?? ''));
}
if ($veri['KVKK Onayı'] !== '') $veri['KVKK Onayı'] = 'Onaylandı';

/* Zorunlu alanlar */
if ($veri['Ad Soyad'] === '') {
    cikis(422, 'Ad Soyad zorunludur.');
}
if (!filter_var($veri['E-posta'], FILTER_VALIDATE_EMAIL)) {
    cikis(422, 'Geçerli bir e-posta adresi gereklidir.');
}

$dizin = kayitDizini();
if (sinirAsildi($dizin)) {
    cikis(429, 'Çok fazla gönderim. Lütfen bir süre sonra tekrar deneyin.');
}

$tarih = date('c');

/* 1) Deftere yaz — e-posta gitmese bile kayıt burada durur */
$yazildi = csvYaz($dizin, $form['tur'], $form['alanlar'],
                  array_merge([$tarih], array_values($veri)));

/* 2) E-posta gönder */
$alanAdi   = preg_replace('/^www\./', '', (string)($_SERVER['HTTP_HOST'] ?? 'localhost'));
$gonderen  = 'site@' . $alanAdi;          // SPF için gönderen bu alan adında olmalı
$konu      = $form['baslik'] . ' — ' . $veri['Ad Soyad']
           . ($veri['Eczane Adı'] !== '' ? ' (' . $veri['Eczane Adı'] . ')' : '');

$uyari = '';
if (!$yazildi) {
    /* Kayıt klasörü yazılamıyor. Talep kaybolmasın diye e-postada
       yüksek sesle söylenir; sessizce yutulursa fark edilmez. */
    $konu  = '[!] ' . $konu;
    $uyari = "!!! DİKKAT !!!\n"
           . "Bu talep sunucuya KAYDEDİLEMEDİ, yalnızca bu e-postada duruyor.\n"
           . "Bu mesajı saklayın ve 'talepler' klasörünün yazma iznini düzeltin.\n"
           . "Beklenen konum: " . dirname(__DIR__) . "/talepler\n\n";
    @error_log('[Artifarma] talepler klasorune yazilamadi: ' . dirname(__DIR__) . '/talepler');
}

$govde = $uyari . $form['baslik'] . "\n" . str_repeat('=', mb_strlen($form['baslik'])) . "\n\n";
foreach ($veri as $alan => $deger) {
    $govde .= str_pad($alan, 16, ' ', STR_PAD_RIGHT) . ': ' . ($deger !== '' ? $deger : '—') . "\n";
}
$govde .= "\nTarih           : " . date('d.m.Y H:i');
$govde .= "\nGönderen IP     : " . istemciIp();
$govde .= "\nKaynak          : https://" . $alanAdi . "\n";

$basliklar = [
    'From: ' . konuKodla('Artıfarma Sitesi') . ' <' . $gonderen . '>',
    'Reply-To: ' . konuKodla($veri['Ad Soyad']) . ' <' . basligaUygun($veri['E-posta']) . '>',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'X-Mailer: Artifarma',
];

$gonderildi = @mail(ALICI, konuKodla($konu), $govde,
                    implode("\r\n", $basliklar), '-f' . $gonderen);

/* 3) Sonuç — ikisi de başarısızsa sayfa yedek yolu (e-posta/WhatsApp) gösterir */
if (!$gonderildi && !$yazildi) {
    cikis(500, 'Gönderim şu anda yapılamıyor.');
}
cikis(200, 'Alındı.');
