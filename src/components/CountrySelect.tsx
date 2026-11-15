import { COUNTRIES } from "../services/countries";

/**
 * Desplegable de países. Si la cuenta trae un país que no está en la lista (un dato antiguo escrito
 * a mano), se muestra igual como primera opción para no perderlo; al elegir otro, se reemplaza.
 */
export function CountrySelect({
  id,
  value,
  onChange,
  required = false,
}: {
  id: string;
  value: string;
  onChange: (country: string) => void;
  required?: boolean;
}) {
  const known = value === "" || COUNTRIES.some((country) => country.name === value);
  return (
    <select
      id={id}
      required={required}
      autoComplete="country-name"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" disabled>
        Elige un país
      </option>
      {!known && <option value={value}>{value}</option>}
      {COUNTRIES.map((country) => (
        <option key={country.code} value={country.name}>
          {country.name}
        </option>
      ))}
    </select>
  );
}
