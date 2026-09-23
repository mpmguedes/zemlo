// GERADO POR apps/mobile/contract/generate.mjs — NÃO EDITAR À MÃO.
//
// Qualquer alteração feita aqui é apagada na próxima geração e, mais importante,
// `node apps/mobile/contract/verify.mjs` falha no CI. Para mudar o contrato, muda-se
// `packages/shared` e volta a correr o gerador.


/// Versão do contrato e caminho base, gerados de `packages/shared/src/version.ts`.
///
/// Não são constantes escritas à mão: se a API mudar de versão, este ficheiro muda pela
/// geração e `verify.mjs` falha até o Dart ser regenerado. É assim que o cliente deixa de
/// poder apontar para um caminho que já não existe.
const String kApiVersion = 'v1';
const String kApiBasePath = '/api/v1';
const String kPlatformVersion = '0.1.0';
