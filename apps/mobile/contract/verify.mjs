#!/usr/bin/env node
/**
 * Verificação de deriva do contrato partilhado (`MOB-001`).
 *
 * ## O que isto prova
 *
 * 1. **O contrato não mudou por baixo do Dart.** Reexecuta o gerador em modo `--check` e falha
 *    se algum ficheiro gerado não corresponder ao `@zemlo/shared` atual. É o que impede a
 *    divergência silenciosa: alguém muda `packages/shared`, o CI fica vermelho, e a mensagem
 *    diz exatamente que ficheiros regenerar.
 * 2. **O manifesto e o Dart não se separaram.** Confirma que cada modelo, enum e tabela de
 *    registo do manifesto existe de facto no Dart gerado. Apanha o caso em que a geração
 *    escreve o manifesto e o ficheiro Dart diverge — um bug do gerador que, sem isto, passaria
 *    por «contrato em sincronia».
 * 3. **Nenhum tipo consumido desapareceu do contrato.** Cada raiz declarada em `CONSUMED`
 *    tem de continuar a existir.
 *
 * ## O que isto **não** prova, e é honesto dizê-lo
 *
 *  - **Não compila o Dart.** Flutter/Dart não estão instalados no ambiente onde isto corre. O
 *    que se verifica é que o Dart gerado corresponde ao contrato; não que ele compila. A
 *    verificação de compilação é `flutter analyze` + `flutter test`, que correm onde houver
 *    SDK — e é por isso que este script existe em Node: para haver **alguma** verificação
 *    executável onde o SDK não está.
 *  - **Não valida os modelos contra respostas reais da API.** Isso é o que `MOB-002` fará com
 *    testes de contrato contra um servidor a sério.
 *
 * Saída: `0` em sincronia, `1` com deriva. Feito para correr no CI sem mais nada instalado.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE = join(HERE, '..');
const MANIFEST = join(HERE, 'contract-manifest.json');
const GENERATED = join(MOBILE, 'lib', 'contract', 'generated');

const failures = [];

/* 1. Deriva face ao contrato ------------------------------------------------ */

console.log('1/3  a comparar o Dart gerado com `@zemlo/shared`…');
try {
  const out = execFileSync(process.execPath, [join(HERE, 'generate.mjs'), '--check'], {
    encoding: 'utf8',
  });
  process.stdout.write(out.replace(/^/gm, '     '));
} catch (error) {
  process.stdout.write(String(error.stdout ?? '').replace(/^/gm, '     '));
  failures.push('o Dart gerado não corresponde ao contrato atual');
}

/* 2. Manifesto ↔ Dart ------------------------------------------------------- */

console.log('2/3  a confirmar que o manifesto e o Dart não se separaram…');

if (!existsSync(MANIFEST)) {
  failures.push('não existe `contract-manifest.json` — corre o gerador');
} else {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const enumsDart = readFileSync(join(GENERATED, 'contract_enums.dart'), 'utf8');
  const modelsDart = readFileSync(join(GENERATED, 'contract_models.dart'), 'utf8');
  const registryDart = readFileSync(join(GENERATED, 'contract_registry.dart'), 'utf8');

  const missingEnums = Object.keys(manifest.enums).filter(
    (name) => !new RegExp(`^enum ${name} \\{`, 'm').test(enumsDart),
  );
  if (missingEnums.length > 0) {
    failures.push(`enums no manifesto e ausentes do Dart: ${missingEnums.join(', ')}`);
  }

  const missingModels = Object.keys(manifest.models).filter(
    (name) => !new RegExp(`^class ${name}(<[^>]*>)? \\{`, 'm').test(modelsDart),
  );
  if (missingModels.length > 0) {
    failures.push(`modelos no manifesto e ausentes do Dart: ${missingModels.join(', ')}`);
  }

  const missingRegistry = Object.keys(manifest.registry).filter(
    (name) => !new RegExp(`^const List<RegistryEntry> k${name} =`, 'm').test(registryDart),
  );
  if (missingRegistry.length > 0) {
    failures.push(`tabelas de registo no manifesto e ausentes do Dart: ${missingRegistry.join(', ')}`);
  }

  // Um manifesto vazio passaria todas as verificações acima por vacuidade. O piso é o que
  // impede isto de ser um teste que passa por não haver nada para verificar.
  const floor = { models: 8, enums: 10, registry: 15 };
  for (const [key, minimum] of Object.entries(floor)) {
    const actual = Object.keys(manifest[key] ?? {}).length;
    if (actual < minimum) {
      failures.push(`manifesto com ${key}=${actual}, abaixo do piso ${minimum} — verificação vacia?`);
    }
  }

  console.log(
    `     ${Object.keys(manifest.models).length} modelos · ${Object.keys(manifest.enums).length} enums · ` +
      `${Object.keys(manifest.registry).length} tabelas de registo — todos presentes no Dart`,
  );
}

/* 3. Tipos consumidos ainda existem no contrato ----------------------------- */

console.log('3/3  a confirmar que os tipos consumidos continuam no contrato…');
try {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const roots = [...new Set(Object.values(manifest.consumed).flat())];
  // Uma raiz pode resolver num **modelo** (`VehicleSummary`), num **enum** (`ApiErrorCode`,
  // que é uma união de literais) ou num **alias**. A primeira versão desta verificação só
  // aceitava modelos e por isso acusou `ApiErrorCode` — o que é a prova de que a verificação
  // não passa por vacuidade: apanhou um erro verdadeiro na própria verificação.
  const known = new Set([
    ...Object.keys(manifest.models),
    ...Object.keys(manifest.enums),
    ...Object.keys(manifest.aliases),
  ]);
  const absent = roots.filter((name) => !known.has(name));
  if (absent.length > 0) {
    failures.push(`tipos consumidos sem nada gerado: ${absent.join(', ')}`);
  } else {
    console.log(`     ${roots.length} raízes consumidas, todas resolvidas: ${roots.join(', ')}`);
  }
} catch (error) {
  failures.push(`não consegui ler as raízes consumidas: ${error.message}`);
}

/* Resultado ----------------------------------------------------------------- */

console.log('');
if (failures.length > 0) {
  console.error('FALHOU:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('Contrato em sincronia. O Dart corresponde a `@zemlo/shared`.');
