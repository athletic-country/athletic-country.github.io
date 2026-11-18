// Configuración de la galería.
// Si apiKey o rootFolderId están vacíos, la página se muestra en MODO DEMO con fotos de ejemplo.
window.GALLERY_CONFIG = {
  // Nombre que aparece en la cabecera
  title: "Athletic Country",
  subtitle: "Galería oficial de fotos",

  // ID de la carpeta raíz de Google Drive (lo que va después de /folders/ en el enlace)
  rootFolderId: "1guvMJAcigfTlj4Bi4GqC_tHFXJZZsKiw",

  // API key de Google Cloud con "Google Drive API" habilitada
  apiKey: "AIzaSyBiN2GcgzunGfdpz5T-ik3fcWgkIu20zj0",

  // Carpeta de Drive con los logos de los sponsors (se muestran al pie del inicio).
  // Nombre de cada archivo = nombre del sponsor. Opcional: "@usuario" de Instagram en el nombre,
  // y un número adelante para ordenar. Ej: "01 Kalcomax @kalcomax.png"
  sponsorsFolderId: "",

  // O lista fija de sponsors (tiene prioridad sobre la carpeta de Drive).
  // { name: "Nombre", logo: "assets/sponsors/archivo.png", instagram: "usuario" o link: "https://..." }
  sponsors: [
    { name: "Amstel", logo: "assets/sponsors/amstel.png" },
    { name: "Chopy", logo: "assets/sponsors/chopy.png" },
    { name: "Country Indumentaria Deportiva", logo: "assets/sponsors/country.png", instagram: "country.ind.deportiva" },
    { name: "Cristalería San Carlos", logo: "assets/sponsors/san-carlos.png", link: "https://www.sancarlos.com.ar" },
    { name: "El Galpón Frutas y Verduras", logo: "assets/sponsors/el-galpon.png" },
    { name: "El Vasco Pinturería", logo: "assets/sponsors/el-vasco.png" },
    { name: "Exquisitos Placeres", logo: "assets/sponsors/exquisitos-placeres.png" },
    { name: "Franco Colella", logo: "assets/sponsors/franco-colella.png" },
    { name: "Giancarelli Gestoría SRL", logo: "assets/sponsors/giancarelli.png" },
    { name: "Jardines del Litoral", logo: "assets/sponsors/jardines-del-litoral.png" },
    { name: "Right Calzado y Accesorios Deportivos", logo: "assets/sponsors/right.png" },
    { name: "Steelmat", logo: "assets/sponsors/steelmat.png" },
  ],
};
