/**
 * `@zemlo/shared` — domínio partilhado do Zemlo.
 *
 * Consumido pela API (validação em tempo de execução) e pelas aplicações cliente
 * (tipos inferidos, apresentação de unidades e datas). Qualquer regra de negócio que
 * precise de existir nos dois lados vive aqui, e só aqui.
 */

export * from './brand.js';
export * from './contracts.js';
export * from './dates.js';
export * from './money.js';
export * from './pt.js';
export * from './registry.js';
export * from './types.js';
export * from './units.js';
export * from './version.js';
