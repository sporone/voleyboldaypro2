# İstanbul Voleybol Puan Durumu Paneli

Bu proje, `https://istanbul.voleyboliltemsilciligi.com/PuanDurumu` adresindeki resmi puan durumu verilerini arka planda çeken ve modern, mobil uyumlu bir web panelinde gösteren küçük bir uygulamadır.

## Çalıştırma

```powershell
.\start-panel.ps1
```

Ardından tarayıcıda şu adresi açın:

```text
http://localhost:3000
```

## Güncelleme Mantığı

- `server.js`, mevcut `scrape_puandurumu_detailed.py` betiğini çalıştırarak resmi sitedeki seçim zincirini tarar.
- API sonucu bellekte ve `.cache/puandurumu-cache.json` dosyasında saklanır.
- Sayfa her 60 saniyede `/api/standings` adresini kontrol eder.
- Sunucu önbelleği 5 dakikadan eskiyse arka planda yeni veri çeker.
- "Şimdi güncelle" butonu kaynak siteyi anlık olarak tekrar taratır.

## Dosyalar

- `index.html`: Yeni panelin yüklendiği giriş sayfası.
- `volley.css`: Modern ve mobil uyumlu arayüz stilleri.
- `volley-app.js`: Filtreler, sekmeler, tablolar ve otomatik yenileme.
- `server.js`: Statik dosya sunucusu ve canlı veri API'si.
- `start-panel.ps1`: Node/Python yolunu bulup panel sunucusunu başlatan PowerShell yardımcısı.
- `scrape_puandurumu_detailed.py`: Resmi kaynaktan puan durumu, maç sonucu ve yarışma verisi çeken tarayıcı.

## Notlar

Canlı veri çekimi için bilgisayarda Node.js ve Python kurulu olmalıdır. Kaynak site geçici olarak yanıt vermezse uygulama son başarılı önbellek verisini göstermeye devam eder.

---

# Eski SporKayıt MVP Notları

Bu MVP, velilerin spor okulu kartlarını inceleyip seçilen okulun WhatsApp hattından ücretsiz deneme dersi talebi göndermesini sağlar.

## Model

- Okulları platforma biz ekleriz.
- Her okulun kartında kendi branşı, ilçesi, yaş aralığı, programı ve WhatsApp numarası olur.
- Veli "Ücretsiz deneme dersi al" butonuna basınca mesaj doğrudan o okulun WhatsApp numarasına gider.
- Okullar kayıt için `https://buymeacoffee.com/bedenegitimi` bağlantısına yönlendirilir.

## Dosyalar

- `index.html`: Ana sayfa, okul listesi, filtreler ve okul kaydı bölümü.
- `styles.css`: Mobil uyumlu arayüz tasarımı.
- `app.js`: Okul verileri, filtreleme ve WhatsApp mesaj mantığı.
- `google-apps-script.gs`: Eski başvuru formu fikri için saklanan Apps Script örneği.

## Okul ekleme

Yeni okul eklemek için `app.js` içindeki `schools` listesine yeni kayıt ekleyin:

```js
{
  name: "Okul Adı",
  sport: "Futbol",
  district: "Kadıköy",
  age: "6-12",
  schedule: "Hafta sonu sabah grupları",
  pitch: "Saha veya salon adı",
  phone: "905xxxxxxxxx",
  highlight: "Okulu anlatan kısa avantaj metni."
}
```

## Okul kaydı

Okullar kayıt için şu bağlantıya yönlendirilir:

```text
https://buymeacoffee.com/bedenegitimi
```

Kayıt sonrasında okul adı, branş, ilçe, yaş aralığı, program, tesis ve WhatsApp numarası alınıp `app.js` içindeki `schools` listesine eklenir.

## Kahve paketleri

- 1 kahve: 1 ay + 1 ay hediye = 2 ay kullanım.
- 3 kahve: 3 ay + 3 ay hediye = 6 ay kullanım.
- 5 kahve: 5 ay + 5 ay hediye = 10 ay kullanım.

1 kahve paketi hızlı deneme, 3 kahve paketi dönem görünürlüğü, 5 kahve paketi ise eylül ayından haziran sonuna kadar sezon görünürlüğü isteyen kulüpler için öne çıkarılır.

## Ilk hedef

- 20 spor okulunu listeye ekle.
- Her okul için doğru WhatsApp numarasını gir.
- Okul kaydı yapmak isteyenleri Buy Me a Coffee bağlantısına yönlendir.
