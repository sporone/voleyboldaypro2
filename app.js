const schools = [
  {
    name: "Kuzey Futbol Okulu",
    sport: "Futbol",
    district: "Kadıköy",
    age: "6-12",
    schedule: "Hafta sonu sabah grupları",
    pitch: "Kalamis Sentetik Saha",
    phone: "905321112233",
    highlight: "İlk deneme dersi ücretsiz, temel futbol eğitimi.",
  },
  {
    name: "Tempo Basket Akademi",
    sport: "Basketbol",
    district: "Beşiktaş",
    age: "7-14",
    schedule: "Hafta içi akşam ve cumartesi",
    pitch: "Fulya Spor Salonu",
    phone: "905331234567",
    highlight: "Koordinasyon, şut tekniği ve takım oyunu odaklı program.",
  },
  {
    name: "Mavi File Voleybol",
    sport: "Voleybol",
    district: "Üsküdar",
    age: "8-16",
    pitch: "Altunizade Spor Salonu",
    schedule: "Pazar ve çarşamba grupları",
    phone: "905445556677",
    highlight: "Yeni başlayanlar ve okul takımına hazırlananlar için.",
  },
  {
    name: "Atlas Yüzme Okulu",
    sport: "Yüzme",
    district: "Ataşehir",
    age: "5-13",
    schedule: "Hafta içi gündüz ve hafta sonu",
    pitch: "Ataşehir Kapalı Havuz",
    phone: "905551112244",
    highlight: "Suya alışma, teknik yüzme ve seviye grupları.",
  },
  {
    name: "Denge Cimnastik Akademisi",
    sport: "Cimnastik",
    district: "Maltepe",
    age: "4-10",
    schedule: "Cumartesi ve pazar",
    pitch: "Maltepe Cimnastik Salonu",
    phone: "905366667788",
    highlight: "Esneklik, denge ve motor beceri gelişimi.",
  },
  {
    name: "Çizgi Futbol Gelişim",
    sport: "Futbol",
    district: "Ataşehir",
    age: "8-15",
    schedule: "Salı, perşembe ve pazar",
    pitch: "Örnek Mahalle Saha",
    phone: "905399998877",
    highlight: "Seviye gruplarına göre teknik ve maç eğitimi.",
  },
];

const state = {
  sport: "",
  district: "",
  age: "",
};

const schoolList = document.querySelector("#school-list");
const sportFilter = document.querySelector("#sport-filter");
const districtFilter = document.querySelector("#district-filter");
const ageFilter = document.querySelector("#age-filter");
const schoolCount = document.querySelector("#school-count");
const sportCount = document.querySelector("#sport-count");
const districtCount = document.querySelector("#district-count");
const paymentLinks = document.querySelectorAll("[data-payment-link]");

function uniqueValues(key) {
  return [...new Set(schools.map((school) => school[key]).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "tr-TR")
  );
}

function fillSelect(select, values, currentValue) {
  const firstOption = select.options[0];
  select.replaceChildren(firstOption);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === currentValue;
    select.append(option);
  });
}

function cleanPhoneNumber(value) {
  const numbers = String(value || "").replace(/\D/g, "");
  if (numbers.startsWith("0")) return `9${numbers}`;
  if (numbers.startsWith("90")) return numbers;
  return numbers.length === 10 ? `90${numbers}` : numbers;
}

function createDemoMessage(school) {
  return `Merhaba ${school.name}, SporKayıt üzerinden ulaştım. Çocuğum için ${school.sport} branşında ücretsiz deneme dersi bilgisi almak istiyorum. Müsait deneme dersi saatlerinizi paylaşabilir misiniz?`;
}

function createWhatsAppUrl(school) {
  return `https://wa.me/${cleanPhoneNumber(school.phone)}?text=${encodeURIComponent(createDemoMessage(school))}`;
}

function getFilteredSchools() {
  return schools.filter((school) => {
    return (
      (!state.sport || school.sport === state.sport) &&
      (!state.district || school.district === state.district) &&
      (!state.age || school.age === state.age)
    );
  });
}

function renderSchoolCard(school) {
  const article = document.createElement("article");
  article.className = "school-card";
  article.innerHTML = `
    <div class="school-card-top">
      <span>${school.sport}</span>
      <strong>${school.district}</strong>
    </div>
    <h3>${school.name}</h3>
    <p>${school.highlight}</p>
    <div class="school-meta">
      <span>${school.age} yaş</span>
      <span>${school.schedule}</span>
      <span>${school.pitch}</span>
    </div>
    <a class="whatsapp-button" href="${createWhatsAppUrl(school)}" target="_blank" rel="noopener">
      Ücretsiz deneme dersi al
    </a>
  `;
  return article;
}

function updateSummary() {
  schoolCount.textContent = schools.length;
  sportCount.textContent = uniqueValues("sport").length;
  districtCount.textContent = uniqueValues("district").length;
}

function render() {
  fillSelect(sportFilter, uniqueValues("sport"), state.sport);
  fillSelect(districtFilter, uniqueValues("district"), state.district);
  fillSelect(ageFilter, uniqueValues("age"), state.age);
  updateSummary();

  schoolList.replaceChildren();
  const filteredSchools = getFilteredSchools();

  if (!filteredSchools.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Bu filtrelere uygun okul yok. Filtreleri değiştirin.";
    schoolList.append(empty);
    return;
  }

  filteredSchools.forEach((school) => schoolList.append(renderSchoolCard(school)));
}

sportFilter.addEventListener("change", (event) => {
  state.sport = event.target.value;
  render();
});

districtFilter.addEventListener("change", (event) => {
  state.district = event.target.value;
  render();
});

ageFilter.addEventListener("change", (event) => {
  state.age = event.target.value;
  render();
});

paymentLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    window.location.href = link.href;
  });
});

render();
