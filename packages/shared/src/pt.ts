/**
 * Normalização e validação de identificadores portugueses.
 *
 * O Zemlo é um produto português: a matrícula é o identificador que o utilizador
 * conhece de cor e o único campo obrigatório do onboarding (§5). Por isso tem de ser
 * aceite em qualquer forma que o utilizador escreva e normalizada de forma estável.
 */

/** Formatos de matrícula portugueses, do mais recente para o mais antigo. */
export type PlateFormat =
  | 'aa-00-aa' // 2020 → hoje: AA-00-AA
  | '00-aa-00' // 2005 → 2020: 00-AA-00
  | '00-00-aa' // 1992 → 2005: 00-00-AA
  | 'aa-00-00' // 1937 → 1992: AA-00-00
  | 'unknown';

export interface NormalizedPlate {
  /** Forma canónica persistida na base de dados: maiúsculas, sem espaços nem separadores. */
  readonly value: string;
  /** Forma legível com hífenes (`42-38-1EL`). */
  readonly display: string;
  /** Formato detetado, para apresentação de ícones e para validações futuras. */
  readonly format: PlateFormat;
  readonly valid: boolean;
}

/**
 * Normaliza uma matrícula portuguesa.
 *
 * Aceita `42-38-1EL`, `4238el`, `42 38 1E L`… e devolve sempre a mesma forma canónica.
 * Não rejeita valores desconhecidos: o Zemlo aceita dados incompletos ou atípicos (§49)
 * e valida a forma, não a existência. A plataforma deve funcionar igualmente para
 * matrículas estrangeiras ou para veículos sem matrícula atribuída.
 */
export function normalizePlate(input: string): NormalizedPlate {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const format = detectPlateFormat(compact);
  return {
    value: compact,
    display: groupPlate(compact),
    format,
    valid: /^[A-Z0-9]{4,10}$/.test(compact),
  };
}

/**
 * Agrupa uma matrícula em blocos de dois caracteres (`42381EL` → `42-38-1EL`).
 *
 * Os formatos portugueses têm seis caracteres e agrupam-se sempre 2-2-2. Matrículas
 * com outro comprimento — importadas de outro país, ou introduzidas de forma atípica —
 * são agrupadas da mesma maneira em vez de apresentadas como um bloco único: é a forma
 * que o utilizador reconhece, e o Zemlo aceita dados atípicos sem os tratar como erro
 * (§49). O valor canónico não muda; apenas a apresentação.
 */
function groupPlate(compact: string): string {
  if (compact.length === 0) return '';
  const groups: string[] = [];
  for (let index = 0; index < compact.length; index += 2) {
    groups.push(compact.slice(index, index + 2));
  }
  return groups.join('-');
}

function detectPlateFormat(compact: string): PlateFormat {
  if (compact.length !== 6) return 'unknown';
  const [a, b, c, d, e, f] = compact.split('');
  if (isDigit(a) && isDigit(b) && isLetter(c) && isLetter(d) && isDigit(e) && isDigit(f)) {
    return '00-aa-00';
  }
  if (isDigit(a) && isDigit(b) && isDigit(c) && isDigit(d) && isLetter(e) && isLetter(f)) {
    return '00-00-aa';
  }
  if (isLetter(a) && isLetter(b) && isDigit(c) && isDigit(d) && isLetter(e) && isLetter(f)) {
    return 'aa-00-aa';
  }
  if (isLetter(a) && isLetter(b) && isDigit(c) && isDigit(d) && isDigit(e) && isDigit(f)) {
    return 'aa-00-00';
  }
  return 'unknown';
}

/** `true` quando a matrícula corresponde a um formato português reconhecido. */
export function isPortuguesePlate(input: string): boolean {
  return detectPlateFormat(input.toUpperCase().replace(/[^A-Z0-9]/g, '')) !== 'unknown';
}

/* -------------------------------------------------------------------------- */
/* VIN / número de chassis                                                     */
/* -------------------------------------------------------------------------- */

const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5,
  P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Valida a forma de um VIN (ISO 3779): 17 caracteres, sem as letras I, O e Q.
 *
 * Separado de `isValidVin` porque as duas verificações têm consequências diferentes.
 * A forma é objetiva — um VIN tem 17 caracteres e nunca contém I, O ou Q, que se
 * confundem com 1 e 0 — e recusá-la é seguro. A letra de controlo é uma verificação mais
 * forte, mas **nem todos os VIN reais a cumprem**: veículos anteriores à norma, alguns
 * fabricantes em mercados específicos e veículos comerciais ligeiros usam numeração
 * própria. Recusar a gravação com base só na letra de controlo impediria o utilizador de
 * registar um veículo legítimo, e o Zemlo aceita dados atípicos sem os tratar como erro
 * (§49). Por isso a forma é exigida e a letra de controlo só gera um aviso.
 */
export function isValidVinFormat(input: string): boolean {
  if (typeof input !== 'string') return false;
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(input.toUpperCase().replace(/[\s-]/g, ''));
}

/**
 * Valida a letra de controlo de um VIN (ISO 3779).
 *
 * O VIN é opcional por design (§10 e §49) e o Zemlo nunca o exige. Quando existe,
 * validá-lo evita associar registos ao veículo errado — importante quando
 * começarem a chegar dados de integrações e de documentos (§50, §51).
 */
export function isValidVin(input: string): boolean {
  const vin = input.toUpperCase().replace(/[\s-]/g, '');
  if (!isValidVinFormat(vin)) return false;
  let sum = 0;
  for (let index = 0; index < 17; index += 1) {
    const char = vin[index] as string;
    const value = isDigit(char) ? Number(char) : VIN_TRANSLITERATION[char];
    if (value === undefined) return false;
    sum += value * (VIN_WEIGHTS[index] as number);
  }
  const check = sum % 11;
  const expected = check === 10 ? 'X' : String(check);
  return vin[9] === expected;
}

/** Normaliza um VIN para a forma canónica (maiúsculas, sem separadores). */
export function normalizeVin(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

/* -------------------------------------------------------------------------- */
/* Código de um carregador / posto                                             */
/* -------------------------------------------------------------------------- */

/** Normaliza um nome de fornecedor/estação para comparação e deduplicação. */
export function normalizeVendorName(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

function isLetter(char: string | undefined): boolean {
  return char !== undefined && char >= 'A' && char <= 'Z';
}
