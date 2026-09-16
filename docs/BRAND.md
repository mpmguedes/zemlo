# Zemlo — símbolo Z-estrada

Documento de identidade visual. Explica o conceito do símbolo, as regras de construção
e as restrições de utilização. O símbolo em produção vive em
`apps/web/public/favicon.svg` e em `apps/web/src/components/Logo.tsx`; este documento é
a especificação que ambos implementam.

---

## 1. Conceito

O Zemlo precisa de um símbolo que se reconheça **sem texto** — num ícone de aplicação,
num favicon de 16 px, numa impressão a preto e branco. A forma escolhida é um **Z
construído como uma estrada em perspetiva**.

O "Z" resolve três problemas ao mesmo tempo:

1. **Identificação.** É a inicial da marca. Quem já conhece o Zemlo reconhece-o na
   gaveta de aplicações sem ler o nome.
2. **Significado.** A barra superior e a diagonal são lidas como uma estrada a fugir para
   o ponto de fuga; a barra inferior, como o troço que se aproxima do observador. O
   símbolo diz "estrada, percurso, direção" sem precisar de o explicar.
3. **Comportamento.** A perspetiva sobrevive à redução. Um símbolo com detalhe perde-se a
   16 px; uma forma construída com três traços e um gradiente não.

O símbolo **não** contém: um automóvel (limita o produto a carros, quando o Zemlo serve
motociclos, furgões e autocaravanas), uma chave (lugar-comum de "gestão de veículos"), nem
um ponteiro de velocímetro (genérico e datado).

---

## 2. Construção

Malha de construção: **quadrado de 100 × 100 unidades**, com 8 unidades de margem de
segurança em todos os lados. A área útil é, portanto, 84 × 84. O símbolo foi desenhado
nesta grelha para poder ser escalado sem perdas.

```
        ┌─────────────────────────────┐
        │  ┌───────────────────────┐  │   barra superior  (largura total, 14 de altura)
        │  │███████████████████████│  │
        │  └───────────────────────┘  │
        │              ╱              │   diagonal (perspetiva: mais larga em baixo)
        │            ╱                │
        │          ╱                  │
        │        ╱                    │
        │  ┌───────────────────────┐  │   barra inferior (14 de altura)
        │  │███████████████████████│  │
        │  └───────────────────────┘  │
        └─────────────────────────────┘
```

- **Barras** — 84 de largura, 14 de altura, cantos arredondados com raio 4. As barras
  representam os dois troços de estrada paralelos ao observador.
- **Diagonal** — espessura variável, de 12 no topo a 22 na base. Esta variação é o que
  cria a perspetiva: uma diagonal de espessura constante lê-se como uma letra, não como
  uma estrada. É o único detalhe que distingue o símbolo de um "Z" tipográfico, e é por
  isso que não pode ser simplificado.
- **Tracejado central** — opcional (variante `road`), uma linha de 2 unidades com
  segmentos de 6 e intervalos de 5, sobre a diagonal. Acrescenta a leitura de "estrada
  vista de cima". Usado em tamanhos ≥ 32 px; **removido abaixo disso**, onde se
  transformaria numa mancha.

### Traçado da diagonal

A diagonal é definida por dois pontos, não por um retângulo inclinado, para que a
espessura variável seja exata:

- aresta esquerda: de `(20, 22)` a `(62, 86)`
- aresta direita: de `(32, 22)` a `(84, 86)`

Isto produz a espessura 12 no topo e 22 na base, com o topo encostado à extremidade
esquerda da barra superior e a base encostada à extremidade direita da barra inferior —
que é o que faz a forma fechar como um "Z" e não como um "N" ou um "7".

---

## 3. Cores

O símbolo funciona em quatro acabamentos, por ordem de preferência:

| Variante | Fundo | Formas | Utilização |
| --- | --- | --- | --- |
| `solid` | verde-petróleo `#178186` | branco | Predefinida. Ícone de aplicação, favicon, cabeçalho |
| `mono` | transparente | tinta escura | Documentos, impressão, marca de água |
| `inverse` | transparente | branco | Sobre fotografia ou superfície escura |
| `amber` | transparente | âmbar `#d99b0b` | Apenas quando o símbolo acompanha uma ação destacada |

**O âmbar nunca é a cor de fundo do símbolo.** Na identidade do Zemlo, o âmbar é
reservado para ações, destaque e alertas (§57); um logótipo âmbar sobre verde-petróleo
gastaria esse significado no elemento mais decorativo da interface.

---

## 4. Assinatura horizontal

Quando acompanhado do nome, a disposição é horizontal: símbolo, 16 unidades de intervalo
(à escala do símbolo), palavra "Zemlo" em versalete com o "Z" maiúsculo.

- Tipografia: grotesca humanista sem serifa, peso **SemiBold (600)**.
- `letter-spacing`: `-0.02em` (a tipografia por omissão é demasiado aberta para uma
  palavra de cinco letras).
- Alinhamento: o símbolo alinha opticamente ao centro da altura de "x" da palavra, e não
  à linha de base — o símbolo é visualmente mais pesado em baixo por causa da perspetiva.

Abaixo de 24 px de altura do símbolo, **usar apenas o símbolo**. A palavra deixa de ser
legível antes de o símbolo o deixar de ser.

---

## 5. Regras de utilização

**Pode:** escalar proporcionalmente; usar sobre as cores da marca; aplicar em positivo e
negativo; usar o símbolo isolado como ícone de aplicação.

**Não pode:** alterar a proporção das barras; tornar a diagonal de espessura constante;
rodar; aplicar sombra, contorno ou bisel; distorcer; usar o símbolo dentro de uma forma
que o corte (o quadrado de segurança de 8 unidades tem de ficar livre); colocar sobre
fotografia sem a variante `inverse`.

**Tamanhos mínimos:** símbolo isolado, 16 px. Assinatura horizontal, 24 px de altura do
símbolo.

---

## 6. Verificação

A forma foi validada nos seguintes contextos, que são os que a especificação exige (§58):

- **Favicon 16 × 16** — a espessura variável sobrevive: a base larga mantém a diagonal
  legível mesmo a 2 px, onde uma diagonal uniforme desapareceria num fio cinzento.
- **Ícone de aplicação 1024 × 1024** — as barras e a diagonal ocupam 84% do quadrado, o
  que aproveita a área útil do ícone sem tocar no recorte do sistema operativo.
- **Uma cor (impressão, fax, gravação)** — a forma lê-se sem depender do gradiente nem da
  cor. Se o símbolo só funcionasse a cores, não cumpriria o requisito de funcionar em
  impressão.
- **Fundo escuro e fundo claro** — a variante `mono` sobre branco e a `inverse` sobre
  petrol têm contraste suficiente (≥ 4,5:1) para serem legíveis em ecrãs de baixa
  qualidade.

O teste decisivo: **um utilizador que veja apenas o símbolo, a 16 px, deve conseguir
desenhá-lo de memória.** Três traços e uma inclinação — é isso que se retém.
