/**
 * Handler para endereços inexistentes dentro do prefixo versionado da API.
 *
 * Vive num módulo próprio, e não em `app.ts`, por duas razões:
 *
 *  1. **Evita um ciclo de importação.** `app.ts` importa os routers, e os routers precisam
 *     deste handler para o registarem como última camada. Se ele vivesse em `app.ts`, os
 *     routers importariam de quem os importa.
 *  2. **Deixa claro que é um contrato da API**, e não um detalhe da composição da
 *     aplicação: um endereço sob `/api/v1/` responde sempre em JSON, nunca com a página
 *     HTML da aplicação web. Sem isto, um cliente que peça um endpoint mal escrito recebe
 *     `index.html` com estado 200 e, ao tentar `JSON.parse`, obtém um erro de sintaxe em
 *     vez de "este endereço não existe".
 *
 * É registado **depois** de todas as rotas de cada router. Um `use` sem caminho corresponde
 * a tudo, pelo que o registar no início responderia 404 a qualquer pedido antes de as rotas
 * serem avaliadas — um defeito que já existiu aqui.
 */

import type { RequestHandler } from 'express';

export const v1NotFound: RequestHandler = (request, response) => {
  response.status(404).json({
    error: {
      code: 'not_found',
      message: `Este endereço não existe na API do Zemlo: ${request.method} ${request.baseUrl}${request.path}`,
      requestId: request.requestId,
    },
  });
};
