import type { SeedAccount } from "../services/auth";

// Cuentas iniciales de DEMOSTRACIÓN. Las claves están a la vista en el código a propósito:
// sirven para probar los roles, no para proteger nada. Sustitúyelas por un servicio real
// antes de usar esto con personas o datos reales.
export const demoAccounts: SeedAccount[] = [
  {
    email: "donald@gmail.com",
    role: "admin",
    password: "12345",
    profile: null,
  },
  {
    email: "liskeyla@gmail.com",
    role: "agencia",
    password: "12345",
    // Datos de relleno para que la cuenta aparezca completa en el panel del administrador.
    profile: {
      fullName: "Liskeyla",
      position: "Coordinación",
      agency: "Agencia de demostración",
      acronym: "DEMO",
      country: "Ecuador",
    },
  },
];
