/**
 * Regras de endereçamento de correio, partilhadas entre a configuração e o cliente SMTP.
 *
 * Vivem aqui, e não dentro do cliente SMTP, porque `core/config.ts` tem de aplicar
 * exatamente as mesmas regras no arranque: uma gralha em `SMTP_FROM` deve falhar antes de a
 * API escutar, e não na primeira entrega de um link de recuperação de password. Duas cópias
 * da mesma regra divergem à primeira alteração; uma só não.
 *
 * Cada função recebe o nome da variável de onde o valor veio (`label`) em vez de o fixar.
 * A mensagem de erro tem de dizer ao operador **qual** das variáveis corrigir, e só quem lê
 * o ambiente sabe qual é.
 */

/** Valor que não serve para o fim a que se destina. */
export class EmailAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailAddressError';
  }
}

/**
 * Recusa CR ou LF.
 *
 * Um valor com uma mudança de linha injeta um cabeçalho novo no `From:` e parte a meio uma
 * linha de comando do protocolo. Em qualquer dos casos, o que chega ao servidor deixa de ser
 * o que o código escreveu — e o que é escrito a seguir à mudança de linha não é escolhido
 * por quem configura.
 *
 * A verificação é a mesma para endereços e para o nome de anfitrião do `EHLO`: o que
 * interessa é que o valor caiba numa linha.
 */
export function assertSingleLine(value: string, label: string): void {
  if (/[\r\n]/.test(value)) {
    throw new EmailAddressError(
      `${label} não pode conter mudanças de linha (CR/LF): ${JSON.stringify(value)}`,
    );
  }
}

/**
 * Endereço para o envelope, a partir de um remetente que pode trazer nome de apresentação.
 *
 * `MAIL FROM` leva um **caminho**, não um endereço de correio completo (RFC 5321 §4.1.1.2).
 * `Zemlo <ola@appzemlo.com>` é válido no cabeçalho `From:` e inválido no envelope: interpolar
 * o valor inteiro dentro de `< >` produz `<Zemlo <ola@appzemlo.com>>`, que o Gmail recusa com
 * `555 5.5.2 Syntax error`.
 *
 * Devolve o interior do **último** `<…>` — o último, e não o primeiro, porque é o endereço que
 * fecha a cadeia — e o próprio valor aparado quando não há parênteses nenhuns. O `[^<>]+`
 * impede que um `<` solto no nome de apresentação seja aceite como se fosse o endereço.
 *
 * Não é um parser de RFC 5322, por isso **recusa em vez de adivinhar**: um valor de que não
 * saia um endereço plausível (`Zemlo <>`, `<>`, ou texto a seguir ao `>`) lança. Devolver o
 * valor inteiro seria repetir em silêncio o mesmo envelope malformado que esta função existe
 * para eliminar — e o modo de falha do defeito original era precisamente esse.
 */
export function envelopeAddress(from: string, label: string): string {
  assertSingleLine(from, label);

  const match = from.match(/<([^<>]+)>\s*$/);
  const address = (match?.[1] ?? from).trim();

  if (address === '' || /[<>\s]/.test(address)) {
    throw new EmailAddressError(
      `${label} não tem um endereço utilizável para o envelope: ${JSON.stringify(from)}`,
    );
  }

  return address;
}

/**
 * Endereço "nu", sem nome de apresentação — o que o `AUTH` leva como utilizador.
 *
 * Ao contrário do remetente, aqui não há cabeçalho onde um nome de apresentação seja
 * legítimo: `Zemlo <ola@appzemlo.com>` é uma configuração errada, não uma forma alternativa
 * de escrever a mesma coisa. Exigir a arroba e recusar espaços, `<` e `>` torna isso explícito.
 */
export function assertBareAddress(value: string, label: string): void {
  assertSingleLine(value, label);

  if (value !== value.trim() || /[<>\s]/.test(value) || !/^[^@\s]+@[^@\s]+$/.test(value)) {
    throw new EmailAddressError(
      `${label} deve ser um endereço de correio sem nome de apresentação: ${JSON.stringify(value)}`,
    );
  }
}
