// =====================================================
//  CONFIGURACIÓN DE LA APP · edita solo este archivo
// =====================================================
window.FERRO_CONFIG = {
  // Supabase > Project Settings > API (o "Connect")
  SUPABASE_URL: 'https://ztymbzjmywktfihwward.supabase.co',
  // La clave pública: "anon public" o "publishable". NUNCA la "service_role" / "secret".
  SUPABASE_ANON_KEY: 'sb_publishable_ZJJ7qM0iziJxDkz6AhMiAQ_4U4lL0gE',

  // Datos que salen en los PDF
  EMPRESA: 'Ferrodistribuciones',
  NIT_EMPRESA: '1234089022',
  DIRECCION_EMPRESA: 'carrera 4 # 29e-288',
  TELEFONO_EMPRESA: '3207501732',
  CORREO_EMPRESA: 'ferrodistribuciones.ip@gmail.com',
  ESLOGAN: 'MATERIALES PARA CONSTRUCCIÓN & FERRETERÍA',
  LOGO_APP: 'logo-app.png', // logo de la barra superior (fondo negro)
  LOGO_PDF: 'logo-pdf.png', // logo blanco del encabezado de los PDF

  // Semáforo: minutos desde que se confirma el pedido hasta que sale completo
  SEMAFORO_VERDE: 20,       // menos de 20 min = verde
  SEMAFORO_AMARILLO: 40,    // de 20 a 40 = amarillo; más de 40 = rojo

  // No cambiar después de crear usuarios
  DOMINIO_USUARIOS: 'ferro.app'
};
