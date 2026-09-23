#!/usr/bin/env node
/**
 * Gerador do cliente Dart do contrato partilhado do Zemlo (`MOB-001`).
 *
 * ## Porque existe
 *
 * A regra do projeto (§6) é «**não duplicar contratos**». Em TypeScript isso resolve-se com
 * um `import`. Em Dart **não há forma de importar** o `@zemlo/shared` — são linguagens
 * diferentes. A única maneira honesta de cumprir a regra é **gerar** o lado Dart a partir da
 * fonte única e **detetar a deriva** quando a fonte muda. É o que este script faz;
 * `verify.mjs` reexecuta-o e falha se o que está no disco não corresponder.
 *
 * ## As duas fontes, e porque são duas
 *
 *  1. **`types.ts` — as respostas.** São `interface`/`type` de TypeScript, **sem existência
 *     em tempo de execução**: nenhum `Object.keys` as vê. Lêem-se pela API do compilador
 *     TypeScript (o `typescript` já é dependência do monorepo).
 *  2. **`contracts.ts` + `registry.ts` — os pedidos e os conjuntos fechados.** São esquemas
 *     Zod, que **são** valores em tempo de execução. Introspecionam-se pelo `dist/`
 *     compilado — o mesmo artefacto que a API e a web consomem, e não uma segunda leitura
 *     do `src/`.
 *
 * ## A regra que impede o gerador de mentir
 *
 * **Nada é ignorado em silêncio.** Um construto que o gerador não saiba mapear faz o script
 * **falhar**, com o nome e o caminho do campo. Um gerador que salta o que não entende produz
 * um manifesto que *parece* completo e não é — e é por aí que uma divergência de contrato
 * entra sem ninguém dar por isso.
 *
 * ## O que fica de fora, declarado
 *
 * As **funções de domínio** (`dates.ts`, `money.ts`, `units.ts`, `registry.ts`:
 * `averageChargingPowerKw`, `daysBetween`, `categoryLabel`, …) **não** são portadas, e não
 * devem ser portadas à mão. Regra de arquitetura: **o servidor calcula, o cliente mostra**.
 * Onde o cliente tenha mesmo de calcular, usa-se o mecanismo de vetores descrito no
 * documento de arquitetura.
 *
 * Uso:
 *   node apps/mobile/contract/generate.mjs           # escreve
 *   node apps/mobile/contract/generate.mjs --check   # compara e sai 1 se houver deriva
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const SHARED_SRC = join(REPO, 'packages', 'shared', 'src');
const SHARED_DIST = join(REPO, 'packages', 'shared', 'dist', 'index.js');
const OUT_DIR = join(HERE, '..', 'lib', 'contract', 'generated');
const MANIFEST = join(HERE, 'contract-manifest.json');
const CHECK = process.argv.includes('--check');

/* -------------------------------------------------------------------------- */
/* 1. O que a mobile consome — declarado, não inferido                         */
/* -------------------------------------------------------------------------- */

/**
 * Raízes do contrato que a app mobile usa.
 *
 * Declarada **à mão de propósito**: é a afirmação «a mobile consome estes tipos». O gerador
 * resolve o fecho transitivo e **falha** se um nome não existir no contrato. Um tipo que a
 * mobile passe a usar sem entrar aqui fica sem modelo Dart e o código não compila — erro
 * barulhento, que é o que se quer, em vez de um `Map<String, dynamic>` a circular em
 * silêncio.
 */
const CONSUMED = {
  'A11 · envelope de erro': ['ApiErrorBody', 'ApiErrorCode'],
  'A23 · sessão e renovação': ['AuthTokens', 'AuthSessionResponse', 'UserProfile'],
  'A9 · paginação por cursor': ['Page'],
  'primeiro tipo de domínio (prova o mecanismo)': ['VehicleSummary'],
};

const roots = [...new Set(Object.values(CONSUMED).flat())].sort();

/* -------------------------------------------------------------------------- */
/* 2. Fontes                                                                   */
/* -------------------------------------------------------------------------- */

const typesFile = join(SHARED_SRC, 'types.ts');
const program = ts.createProgram([typesFile], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  strict: true,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(typesFile);
if (!source) throw new Error(`Não consegui abrir ${typesFile}`);

const ownDiagnostics = ts
  .getPreEmitDiagnostics(program)
  .filter((d) => d.file?.fileName === typesFile);
if (ownDiagnostics.length > 0) {
  const text = ownDiagnostics
    .map((d) => `  ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)
    .join('\n');
  throw new Error(`\`types.ts\` não compila — o gerador recusa gerar a partir de um contrato inválido:\n${text}`);
}

const declarations = new Map();
for (const statement of source.statements) {
  const isExported =
    ts.canHaveModifiers(statement) &&
    ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  if (!isExported) continue;
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
    declarations.set(statement.name.text, statement);
  }
}

const runtime = await import(pathToFileURL(SHARED_DIST).href);

/**
 * **Conjuntos fechados de códigos**, lidos dos `ZodEnum` exportados.
 *
 * São a autoridade em tempo de execução: é com eles que a API valida. O nome Dart é o nome
 * do contrato sem o prefixo `z` (`zExpenseCategory` → `ExpenseCategory`), que coincide com o
 * alias de TypeScript homónimo em `registry.ts` — e é isso que permite dar ao campo
 * `Expense.category` o nome que o contrato lhe dá, em vez de um nome inventado pelo caminho.
 */
const zodEnums = new Map();
for (const [name, value] of Object.entries(runtime)) {
  if (!name.startsWith('z') || value?._def?.typeName !== 'ZodEnum') continue;
  zodEnums.set(name.slice(1), value._def.values);
}

/** Índice inverso: valores ⇒ nome. É o que identifica um enum pelo conteúdo. */
const enumNameByValues = new Map();
for (const [name, values] of zodEnums) {
  enumNameByValues.set([...values].sort().join('\u0000'), name);
}

/**
 * **Tabelas de registo**, lidas dos arrays de objetos com `code`.
 *
 * Não são listas de códigos: cada entrada traz o **rótulo em português, o ícone e a ordem**
 * (`{ code, label, icon, order, energy?, recurring? }`). É apresentação, e vive no contrato
 * de propósito, para a web e o mobile dizerem a mesma palavra sobre a mesma coisa. Se a
 * mobile escrevesse estes rótulos à mão, os dois produtos divergiriam na primeira alteração
 * de texto — é exatamente o que a regra «não duplicar contratos» existe para impedir.
 *
 * `COLUMN_SYNONYMS` fica de fora: é uma tabela de sinónimos da importação de CSV, não uma
 * lista fechada do domínio.
 */
const registrySets = new Map();
for (const [name, value] of Object.entries(runtime)) {
  if (!Array.isArray(value) || value.length === 0) continue;
  if (name === 'COLUMN_SYNONYMS') continue;
  if (!value.every((entry) => entry && typeof entry === 'object' && typeof entry.code === 'string')) {
    continue;
  }
  registrySets.set(name, value);
}

/* -------------------------------------------------------------------------- */
/* 3. Acumuladores                                                             */
/* -------------------------------------------------------------------------- */

/** Modelos Dart a emitir: nome → { typeParams, fields } */
const models = new Map();
/** Alias simples: nome do contrato → tipo Dart (ex.: `type Id = string`). */
const aliases = new Map();
/** Enums: nome Dart → valores do fio. */
const enums = new Map();
/** Nomes já resolvidos ou em resolução (evita recursão infinita). */
const inProgress = new Set();
/** Tipos inline anónimos: nome sintético → nó de tipo. */
const inlineTypes = new Map();

const UNMAPPABLE = [];

/* -------------------------------------------------------------------------- */
/* 4. Tipo TypeScript → tipo Dart                                              */
/* -------------------------------------------------------------------------- */

function toDartType(type, path, subst = new Map()) {
  // Parâmetro de tipo genérico (`T` em `Page<T>`): substitui-se pelo argumento concreto.
  if (type.flags & ts.TypeFlags.TypeParameter) {
    const key = type.symbol?.name;
    if (key && subst.has(key)) return toDartType(subst.get(key), path, subst);
    return key ?? 'Object?';
  }

  if (type.flags & ts.TypeFlags.StringLike) return 'String';
  if (type.flags & ts.TypeFlags.NumberLike) return 'num';
  if (type.flags & ts.TypeFlags.BooleanLike) return 'bool';
  if (type.flags & ts.TypeFlags.Any) return 'Object?';
  if (type.flags & ts.TypeFlags.Unknown) return 'Object?';

  if (type.isUnion()) {
    const members = type.types.filter(
      (t) => !(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)),
    );
    const nullable = members.length !== type.types.length;

    if (members.length === 0) return 'Object?';
    if (members.every((t) => t.isStringLiteral())) {
      const values = members.map((t) => t.value);
      const name = registerInlineEnum(path, values, type);
      return nullable ? `${name}?` : name;
    }
    if (members.length === 1) {
      const inner = toDartType(members[0], path, subst);
      return nullable ? `${inner}?` : inner;
    }
    UNMAPPABLE.push(`${path}: união não mapeável — ${checker.typeToString(type)}`);
    return 'Object?';
  }

  if (type.flags & ts.TypeFlags.Null || type.flags & ts.TypeFlags.Undefined) return 'Object?';

  if (checker.isArrayType(type)) {
    const [element] = checker.getTypeArguments(type);
    return `List<${toDartType(element, `${path}[]`, subst)}>`;
  }

  const stringIndex = type.getStringIndexType();
  if (stringIndex) return `Map<String, ${toDartType(stringIndex, `${path}{}`, subst)}>`;

  const symbol = type.aliasSymbol ?? type.getSymbol();
  const decl = symbol?.declarations?.find(
    (d) => ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d),
  );

  if (decl) {
    const name = decl.name.text;
    if (ts.isTypeAliasDeclaration(decl)) {
      // Alias com parâmetros próprios não existe no contrato; os simples resolvem-se aqui.
      if (decl.typeParameters && decl.typeParameters.length > 0) {
        UNMAPPABLE.push(`${path}: alias genérico \`${name}\` não suportado`);
        return 'Object?';
      }
      ensureAlias(name);
      return aliases.get(name) ?? 'Object?';
    }

    // Interface: pode ser genérica (`Page<T>`).
    const params = decl.typeParameters?.map((p) => p.name.text) ?? [];
    const args = checker.getTypeArguments(type);
    const inner = new Map(subst);
    params.forEach((p, i) => {
      if (args[i]) inner.set(p, args[i]);
    });

    if (params.length > 0) {
      const rendered = params.map((p) => (inner.has(p) ? toDartType(inner.get(p), path, subst) : p));
      // Instanciação concreta de um genérico: o modelo Dart gerado é genérico, e o uso é
      // `Page<VehicleSummary>` — o Dart resolve isto sozinho, não é preciso gerar duas vezes.
      ensureModel(name, inner);
      return `${name}<${rendered.join(', ')}>`;
    }

    ensureModel(name, inner);
    return name;
  }

  // Objeto literal anónimo → tipo próprio, nomeado pelo caminho.
  if (type.getProperties().length > 0) {
    const name = syntheticName(path);
    inlineTypes.set(name, { type, path });
    ensureInlineModel(name);
    return name;
  }

  UNMAPPABLE.push(`${path}: tipo não mapeável — ${checker.typeToString(type)}`);
  return 'Object?';
}

/** `TimelineItem.kind` → `TimelineItemKind`; `a.b[]` → `ABItem`. */
function syntheticName(path) {
  const cleaned = path.replace(/\[\]/g, 'Item').replace(/[{}]/g, '');
  return cleaned
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Escolhe o nome Dart de um conjunto de valores literais, por ordem de autoridade:
 *
 *  1. **o nome do contrato**, se os valores coincidirem com um `ZodEnum` exportado — é o caso
 *     de `ExpenseCategory`, `FuelType`, etc., cujos valores vêm de `registry.ts` e cujo nome
 *     o contrato já fixou;
 *  2. **o alias de TypeScript** do próprio tipo (`type ApiErrorCode = …`), para as uniões que
 *     o contrato nomeia em `types.ts`;
 *  3. **um nome derivado do caminho**, só quando o contrato não deu nome nenhum — e nesse caso
 *     o manifesto mostra o nome, para ser visto e não passado despercebido.
 */
function registerInlineEnum(path, values, type) {
  const byValues = enumNameByValues.get([...values].sort().join('\u0000'));
  if (byValues) return byValues;

  const alias = type?.aliasSymbol?.name;
  if (alias && declarations.has(alias)) {
    const existing = enums.get(alias);
    if (existing && JSON.stringify([...existing].sort()) !== JSON.stringify([...values].sort())) {
      UNMAPPABLE.push(`${path}: o alias \`${alias}\` deu dois conjuntos de valores diferentes`);
      return alias;
    }
    enums.set(alias, values);
    return alias;
  }

  const name = syntheticName(path);
  const existing = enums.get(name);
  if (existing && JSON.stringify(existing) !== JSON.stringify(values)) {
    UNMAPPABLE.push(`${path}: dois enums inline diferentes com o mesmo nome \`${name}\``);
  }
  enums.set(name, values);
  return name;
}

/* -------------------------------------------------------------------------- */
/* 5. Resolução de modelos                                                     */
/* -------------------------------------------------------------------------- */

function ensureAlias(name) {
  if (aliases.has(name) || inProgress.has(`alias:${name}`)) return;
  const decl = declarations.get(name);
  if (!decl || !ts.isTypeAliasDeclaration(decl)) return;
  inProgress.add(`alias:${name}`);
  const dart = toDartType(checker.getTypeAtLocation(decl.type), name);
  // Se o alias acabou por produzir um enum inline, o nome do enum é o do alias.
  if (enums.has(name)) {
    aliases.set(name, name);
    return;
  }
  aliases.set(name, dart);
}

function ensureModel(name, subst = new Map()) {
  if (models.has(name) || inProgress.has(`model:${name}`)) return;
  const decl = declarations.get(name);
  if (!decl || !ts.isInterfaceDeclaration(decl)) return;
  inProgress.add(`model:${name}`);

  const typeParams = decl.typeParameters?.map((p) => p.name.text) ?? [];
  const fields = [];
  for (const member of decl.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;
    const fieldName = member.name.getText(source).replace(/['"]/g, '');
    const type = checker.getTypeOfSymbolAtLocation(
      checker.getSymbolAtLocation(member.name),
      member,
    );
    const optional = Boolean(member.questionToken);
    const dartType = toDartType(type, `${name}.${fieldName}`, subst);
    fields.push({
      name: fieldName,
      dartType: optional && !dartType.endsWith('?') ? `${dartType}?` : dartType,
      optional,
    });
  }
  models.set(name, { typeParams, fields });
}

function ensureInlineModel(name) {
  if (models.has(name) || inProgress.has(`model:${name}`)) return;
  const entry = inlineTypes.get(name);
  if (!entry) return;
  inProgress.add(`model:${name}`);
  const fields = [];
  for (const prop of entry.type.getProperties()) {
    const fieldName = prop.name;
    const type = checker.getTypeOfSymbolAtLocation(prop, source);
    const optional = Boolean(prop.flags & ts.SymbolFlags.Optional);
    const dartType = toDartType(type, `${entry.path}.${fieldName}`);
    fields.push({
      name: fieldName,
      dartType: optional && !dartType.endsWith('?') ? `${dartType}?` : dartType,
      optional,
    });
  }
  models.set(name, { typeParams: [], fields });
}

// Fecho transitivo: `ensureModel` acrescenta modelos enquanto corre, logo repete-se até
// estabilizar. O limite existe para um ciclo do próprio gerador falhar alto em vez de
// ficar preso.
for (const root of roots) {
  ensureModel(root);
}
for (let round = 0; round < 200; round += 1) {
  const before = models.size + aliases.size;
  for (const name of [...models.keys()]) ensureModel(name);
  for (const name of [...aliases.keys()]) ensureAlias(name);
  if (models.size + aliases.size === before) break;
}

if (UNMAPPABLE.length > 0) {
  throw new Error(
    'O gerador encontrou construtos que não sabe mapear. Não gera um contrato incompleto:\n' +
      UNMAPPABLE.map((m) => `  - ${m}`).join('\n'),
  );
}

/*
 * Nenhuma raiz declarada pode ficar por resolver.
 *
 * Esta verificação nasceu de uma **mutação que sobreviveu**: com um nome inexistente em
 * `CONSUMED`, a primeira versão do gerador produzia os 11 modelos, escrevia o manifesto e
 * saía com código 0 — o tipo desconhecido era simplesmente ignorado. Ou seja, o gerador fazia
 * exatamente aquilo que o cabeçalho deste ficheiro diz que ele nunca faz. Sem a mutação, o
 * defeito passava; o docblock é que estava errado, não o código, e foi o código que se mudou.
 *
 * Aceita as três formas em que uma raiz se pode resolver: modelo (`VehicleSummary`), enum
 * (`ApiErrorCode`, que é uma união de literais) ou alias.
 */
const resolvedRoots = new Set([...models.keys(), ...enums.keys(), ...aliases.keys()]);
const unresolvedRoots = roots.filter((root) => !resolvedRoots.has(root));
if (unresolvedRoots.length > 0) {
  throw new Error(
    `A lista \`CONSUMED\` declara tipos que não produziram nada a partir do contrato: ` +
      `${unresolvedRoots.join(', ')}. Ou o nome mudou em \`types.ts\`, ou está mal escrito — ` +
      'as duas coisas resolvem-se à mão, e o gerador recusa gerar um contrato que não os inclui.',
  );
}

/* -------------------------------------------------------------------------- */
/* 6. Emissão do Dart                                                          */
/* -------------------------------------------------------------------------- */

const HEADER = `// GERADO POR apps/mobile/contract/generate.mjs — NÃO EDITAR À MÃO.
//
// Qualquer alteração feita aqui é apagada na próxima geração e, mais importante,
// \`node apps/mobile/contract/verify.mjs\` falha no CI. Para mudar o contrato, muda-se
// \`packages/shared\` e volta a correr o gerador.
`;

function dartString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Todos os enums que o Dart recebe: os **conjuntos fechados do contrato** (todos os
 * `ZodEnum`, para a mobile ter a superfície completa e não ter de a completar à mão) mais os
 * que apareceram dentro dos tipos consumidos.
 */
const allEnums = new Map(zodEnums);
for (const [name, values] of enums) {
  const existing = allEnums.get(name);
  if (existing && JSON.stringify([...existing].sort()) !== JSON.stringify([...values].sort())) {
    UNMAPPABLE.push(`enum \`${name}\` com valores divergentes entre o contrato e o tipo consumido`);
    continue;
  }
  allEnums.set(name, values);
}

function emitEnums() {
  const lines = [HEADER, '', '// ignore_for_file: constant_identifier_names', ''];
  const entries = [...allEnums.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [name, values] of entries) {
    lines.push(`/// Conjunto fechado do contrato: \`${name}\`.`);
    lines.push('///');
    lines.push('/// O valor do fio da API é o do contrato — não há tradução de nomes.');
    lines.push(`enum ${name} {`);
    for (const value of values) {
      lines.push(`  ${enumMember(value)}(${dartString(value)}),`);
    }
    lines.push('  ;');
    lines.push('');
    lines.push(`  const ${name}(this.wire);`);
    lines.push('');
    lines.push('  /// Valor tal como viaja no JSON.');
    lines.push('  final String wire;');
    lines.push('');
    lines.push('  /// Converte o valor do fio no membro correspondente.');
    lines.push('  ///');
    lines.push('  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma');
    lines.push('  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.');
    lines.push(`  static ${name} fromWire(String value) =>`);
    lines.push(`      ${name}.values.firstWhere(`);
    lines.push('        (candidate) => candidate.wire == value,');
    lines.push('        orElse: () => throw ArgumentError(');
    lines.push(`          'Valor \${value} não pertence ao conjunto fechado ${name}. '`);
    lines.push("          'O contrato mudou ou a resposta não é a esperada.',");
    lines.push('        ),');
    lines.push('      );');
    lines.push('}');
    lines.push('');
  }
  return lines.join('\n');
}

function enumMember(value) {
  const cleaned = value
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const identifier = cleaned.length > 0 ? cleaned : 'empty';
  return /^[0-9]/.test(identifier) ? `v_${identifier}` : identifier;
}

function isEnumType(dartType) {
  const bare = dartType.replace(/\?$/, '');
  return enums.has(bare);
}

function isModelType(dartType) {
  const bare = dartType.replace(/\?$/, '').replace(/<.*>$/, '');
  return models.has(bare);
}

/** `T` → `t` (nome do parâmetro do conversor gerado). */
function lowerFirst(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** Expressão Dart que lê um campo do `json` já tipado. */
function fromJsonExpr(dartType, key, typeParams = new Set()) {
  const nullable = dartType.endsWith('?');
  const bare = dartType.replace(/\?$/, '');
  const access = `json[${dartString(key)}]`;

  let expr;
  if (bare === 'String') expr = `${access} as String`;
  else if (bare === 'num') expr = `${access} as num`;
  else if (bare === 'bool') expr = `${access} as bool`;
  else if (bare === 'Object?') expr = access;
  else if (typeParams.has(bare)) expr = `${lowerFirst(bare)}FromJson(${access})`;
  else if (isEnumType(bare)) expr = `${bare}.fromWire(${access} as String)`;
  else if (bare.startsWith('List<')) {
    const inner = bare.slice(5, -1);
    const innerBare = inner.replace(/\?$/, '');
    const item = isEnumType(innerBare)
      ? `${innerBare}.fromWire(item as String)`
      : isModelType(innerBare)
        ? `${innerBare}.fromJson(item as Map<String, dynamic>)`
        : typeParams.has(innerBare)
          ? `${lowerFirst(innerBare)}FromJson(item)`
          : `item as ${inner}`;
    expr = `(${access} as List).map((item) => ${item}).toList()`;
  } else if (bare.startsWith('Map<String, ')) {
    const inner = bare.slice('Map<String, '.length, -1);
    expr = `(${access} as Map).map((key, value) => MapEntry(key as String, value as ${inner}))`;
  } else if (isModelType(bare)) {
    expr = `${bare}.fromJson(${access} as Map<String, dynamic>)`;
  } else {
    expr = `${access} as ${bare}`;
  }

  // Campo opcional: o contrato diz `campo?: T`, logo `null` é um valor legítimo e não uma
  // divergência. Não se usa `!` nem um valor de recurso — ausente fica ausente.
  return nullable ? `${access} == null ? null : ${expr}` : expr;
}

/** Expressão Dart que escreve um campo no mapa `toJson`. */
function toJsonExpr(dartType, accessor) {
  const nullable = dartType.endsWith('?');
  const bare = dartType.replace(/\?$/, '');
  const value = nullable ? `${accessor}!` : accessor;

  let expr;
  if (isEnumType(bare)) expr = `${value}.wire`;
  else if (bare.startsWith('List<')) {
    const inner = bare.slice(5, -1).replace(/\?$/, '');
    expr = isModelType(inner) ? `${value}.map((item) => item.toJson()).toList()` : value;
  } else if (isModelType(bare)) expr = `${value}.toJson()`;
  else expr = value;

  return nullable ? `${accessor} == null ? null : ${expr}` : expr;
}

function emitModels() {
  const lines = [HEADER, '', '// ignore_for_file: prefer_const_constructors', ''];
  const entries = [...models.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [name, model] of entries) {
    const params = model.typeParams.length > 0 ? `<${model.typeParams.join(', ')}>` : '';
    lines.push(`/// Modelo do contrato \`${name}\`.`);
    lines.push('class ' + name + params + ' {');
    lines.push(`  const ${name}({`);
    for (const field of model.fields) {
      lines.push(`    required this.${field.name},`);
    }
    lines.push('  });');
    lines.push('');

    for (const field of model.fields) {
      lines.push(`  final ${field.dartType} ${field.name};`);
    }
    lines.push('');

    // fromJson
    //
    // Um modelo genérico (`Page<T>`) **não pode** fazer `item as T`: em Dart, `T` é apagado em
    // tempo de execução e o cast falharia com `Page<VehicleSummary>`. O gerador passa então um
    // conversor obrigatório por parâmetro de tipo — a única forma de o chamador dizer como se
    // constrói um `T`. Foi um defeito real da primeira versão gerada, apanhado a ler o output.
    if (model.typeParams.length > 0) {
      const converters = model.typeParams.map((p) => `${p} Function(Object? json) ${lowerFirst(p)}FromJson`);
      lines.push(
        `  factory ${name}.fromJson(Map<String, dynamic> json, ${converters.join(', ')}) {`,
      );
    } else {
      lines.push(`  factory ${name}.fromJson(Map<String, dynamic> json) {`);
    }
    lines.push(`    return ${name}${params}(`);
    for (const field of model.fields) {
      lines.push(`      ${field.name}: ${fromJsonExpr(field.dartType, field.name, new Set(model.typeParams))},`);
    }
    lines.push('    );');
    lines.push('  }');
    lines.push('');

    // toJson
    lines.push('  Map<String, dynamic> toJson() {');
    lines.push('    return <String, dynamic>{');
    for (const field of model.fields) {
      lines.push(`      ${dartString(field.name)}: ${toJsonExpr(field.dartType, `this.${field.name}`)},`);
    }
    lines.push('    };');
    lines.push('  }');
    lines.push('}');
    lines.push('');
  }
  return lines.join('\n');
}

function emitConstants() {
  const apiVersion = runtime.API_VERSION;
  const apiBasePath = runtime.API_BASE_PATH;
  const platformVersion = runtime.PLATFORM_VERSION;
  return [
    HEADER,
    '',
    '/// Versão do contrato e caminho base, gerados de `packages/shared/src/version.ts`.',
    '///',
    '/// Não são constantes escritas à mão: se a API mudar de versão, este ficheiro muda pela',
    '/// geração e `verify.mjs` falha até o Dart ser regenerado. É assim que o cliente deixa de',
    '/// poder apontar para um caminho que já não existe.',
    `const String kApiVersion = ${dartString(apiVersion)};`,
    `const String kApiBasePath = ${dartString(apiBasePath)};`,
    `const String kPlatformVersion = ${dartString(platformVersion)};`,
    '',
  ].join('\n');
}

/**
 * Tabelas de registo com rótulo, ícone e ordem.
 *
 * Geradas, e não escritas à mão no Dart, porque são **apresentação partilhada**: a web mostra
 * «Combustível» com ⛽ e a mobile tem de mostrar exatamente o mesmo. Duas listas escritas à
 * mão divergem na primeira alteração de texto, e ninguém dá por isso até um utilizador ver
 * palavras diferentes na web e no telemóvel.
 */
function emitRegistry() {
  const lines = [HEADER, '', '/// Entrada de uma tabela de registo do contrato.'];
  lines.push('class RegistryEntry {');
  lines.push('  const RegistryEntry({');
  lines.push('    required this.code,');
  lines.push('    required this.label,');
  lines.push('    required this.icon,');
  lines.push('    required this.order,');
  lines.push('    this.energy = false,');
  lines.push('    this.recurring = false,');
  lines.push('  });');
  lines.push('');
  lines.push('  /// Código do fio da API.');
  lines.push('  final String code;');
  lines.push('  /// Rótulo em português, escrito para ser lido por uma pessoa (§59).');
  lines.push('  final String label;');
  lines.push('  final String icon;');
  lines.push('  final int order;');
  lines.push('  final bool energy;');
  lines.push('  final bool recurring;');
  lines.push('}');
  lines.push('');

  for (const [name, entries] of [...registrySets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`/// \`${name}\` — ${entries.length} entradas, na ordem definida pelo contrato.`);
    lines.push(`const List<RegistryEntry> k${name} = <RegistryEntry>[`);
    for (const entry of entries) {
      const parts = [
        `code: ${dartString(entry.code)}`,
        `label: ${dartString(entry.label)}`,
        `icon: ${dartString(entry.icon ?? '')}`,
        `order: ${Number(entry.order ?? 0)}`,
      ];
      if (entry.energy) parts.push('energy: true');
      if (entry.recurring) parts.push('recurring: true');
      lines.push(`  RegistryEntry(${parts.join(', ')}),`);
    }
    lines.push('];');
    lines.push('');
  }
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* 7. Manifesto — a prova de que os dois lados falam do mesmo contrato         */
/* -------------------------------------------------------------------------- */

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Mede, em `registry.ts`, quantos aliases `CodeOf<…>` ficam **abertos** (`string`) em vez de
 * virem como união de literais.
 *
 * É o número que sustenta a fragilidade descrita acima: sem ele, a afirmação «o contrato é
 * mais fraco do que o runtime» seria uma opinião. Com ele, é uma contagem reproduzível.
 */
function measureOpenCodeAliases() {
  const registryFile = join(SHARED_SRC, 'registry.ts');
  const registryProgram = ts.createProgram([registryFile], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
    skipLibCheck: true,
  });
  const registryChecker = registryProgram.getTypeChecker();
  const registrySource = registryProgram.getSourceFile(registryFile);
  if (!registrySource) return { total: 0, open: 0, names: [] };

  const names = [];
  for (const statement of registrySource.statements) {
    if (!ts.isTypeAliasDeclaration(statement)) continue;
    if (!statement.type.getText(registrySource).startsWith('CodeOf<')) continue;
    const type = registryChecker.getTypeAtLocation(statement.type);
    const closed = type.isUnion() && type.types.every((t) => t.isStringLiteral());
    if (!closed) names.push(statement.name.text);
  }
  return { total: names.length, open: names.length, names: names.sort() };
}

/** Fragilidades medidas: campos que saíram como `String` embora o domínio tenha um conjunto
 * fechado com o nome correspondente.
 *
 * A comparação é pelo **nome do campo em PascalCase** (`vehicleType` → `VehicleType`), o que
 * é conservador de propósito: apanha os casos inequívocos e não inventa correspondências
 * (`category` → `Category` não existe, e por isso não é reportado, embora o domínio tenha
 * `ExpenseCategory`). O número real é maior do que o que aqui aparece.
 */
const openCodeAliases = measureOpenCodeAliases();

const weaknesses = {
  note:
    'Campos do contrato cujo tipo TypeScript é `string` mas cujo domínio tem conjunto fechado. ' +
    'Causa: `registry.ts` declara `freeze<T extends readonly OptionMeta[]>(items: T): T` e ' +
    '`OptionMeta.code` é `string`, pelo que os códigos literais alargam e `CodeOf<T>` resolve ' +
    'para `string`. Só o esquema Zod os fecha, em tempo de execução.',
  codeOfAliasesTotal: openCodeAliases.total,
  codeOfAliasesWithoutClosedSet: openCodeAliases.open,
  codeOfAliasesOpenNames: openCodeAliases.names,
  stringFieldsWithEnumOfSameName: [],
};

for (const [modelName, model] of [...models.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  for (const field of model.fields) {
    const bare = field.dartType.replace(/\?$/, '');
    if (bare !== 'String') continue;
    const candidate = field.name.charAt(0).toUpperCase() + field.name.slice(1);
    if (!zodEnums.has(candidate)) continue;
    weaknesses.stringFieldsWithEnumOfSameName.push(`${modelName}.${field.name} → ${candidate}`);
  }
}

const manifest = {
  generatedBy: 'apps/mobile/contract/generate.mjs',
  contractPackage: '@zemlo/shared',
  contractSourceHash: {
    'packages/shared/src/types.ts': hashFile(typesFile),
    'packages/shared/dist/index.js': hashFile(SHARED_DIST),
  },
  versions: {
    platform: runtime.PLATFORM_VERSION,
    api: runtime.API_VERSION,
    basePath: runtime.API_BASE_PATH,
  },
  consumed: CONSUMED,
  enums: Object.fromEntries([...allEnums.entries()].sort(([a], [b]) => a.localeCompare(b))),
  models: Object.fromEntries(
    [...models.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, model]) => [
        name,
        {
          typeParams: model.typeParams,
          fields: Object.fromEntries(model.fields.map((f) => [f.name, f.dartType])),
        },
      ]),
  ),
  aliases: Object.fromEntries([...aliases.entries()].sort(([a], [b]) => a.localeCompare(b))),
  registry: Object.fromEntries(
    [...registrySets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, entries]) => [name, entries.map((e) => e.code)]),
  ),
  /**
   * Fragilidades do contrato **medidas** por este gerador, não estimadas.
   *
   * Ficam no artefacto porque um manifesto que só lista o que corre bem esconde o que
   * interessa: quem lê isto vê logo onde é que o tipo de TypeScript é mais fraco do que a
   * validação de tempo de execução, e onde é que um campo Dart ficou `String` quando o
   * domínio tem um conjunto fechado.
   */
  knownWeaknesses: weaknesses,
};

/* -------------------------------------------------------------------------- */
/* 8. Escrita (ou comparação, em `--check`)                                    */
/* -------------------------------------------------------------------------- */

const outputs = new Map([
  [join(OUT_DIR, 'contract_enums.dart'), emitEnums()],
  [join(OUT_DIR, 'contract_models.dart'), emitModels()],
  [join(OUT_DIR, 'contract_constants.dart'), emitConstants()],
  [join(OUT_DIR, 'contract_registry.dart'), emitRegistry()],
  [MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`],
]);

const drift = [];
if (CHECK) {
  for (const [path, content] of outputs) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current !== content) drift.push(path);
  }
  if (drift.length > 0) {
    console.error('DERIVA DE CONTRATO detetada. Os ficheiros abaixo não correspondem ao contrato atual:');
    for (const path of drift) console.error(`  - ${path}`);
    console.error('\nCorreção: `node apps/mobile/contract/generate.mjs` e revê o diff.');
    process.exit(1);
  }
  console.log('Contrato em sincronia: os ficheiros gerados correspondem a `@zemlo/shared`.');
  console.log(`  modelos: ${models.size} · enums: ${allEnums.size} · tabelas de registo: ${registrySets.size}`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [path, content] of outputs) writeFileSync(path, content, 'utf8');

console.log('Contrato gerado para Dart.');
console.log(`  modelos: ${models.size} · enums: ${allEnums.size} · tabelas de registo: ${registrySets.size}`);
console.log(`  raízes consumidas: ${roots.join(', ')}`);
console.log(`  ficheiros: ${[...outputs.keys()].map((p) => p.replace(REPO, '')).join(', ')}`);
