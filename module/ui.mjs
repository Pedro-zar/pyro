/**
 * Utilidades de interface compartilhadas por fichas, cards de chat e diálogos.
 */

import { dialogoDoAtor } from "./tema.mjs";

/** Escapa texto para entrar em HTML montado à mão. */
export const esc = texto => Handlebars.escapeExpression(texto ?? "");

/**
 * Enriquece um campo de texto (links, rolagens inline, segredos) do ponto de
 * vista do documento dono.
 */
export function enriquecer(texto, documento) {
  return foundry.applications.ux.TextEditor.implementation.enrichHTML(texto ?? "", {
    relativeTo: documento,
    secrets: documento.isOwner
  });
}

/**
 * Diálogo de formulário simples no tema do ator: um conteúdo HTML com campos
 * e um botão de confirmar.
 * @param {Actor} actor
 * @param {object} opcoes
 * @param {string} opcoes.titulo já traduzido.
 * @param {string} opcoes.conteudo HTML do formulário.
 * @param {string} [opcoes.rotuloOk] chave de tradução do botão (padrão: Rolar).
 * @returns {Promise<object|null>} os campos preenchidos, ou null se fechou.
 */
export async function formularioDoAtor(actor, { titulo, conteudo, rotuloOk = "PYRO.Rolar" }) {
  const resposta = await foundry.applications.api.DialogV2.prompt({
    ...dialogoDoAtor(actor),
    window: { title: titulo },
    content: conteudo,
    ok: {
      label: game.i18n.localize(rotuloOk),
      callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
    },
    rejectClose: false
  });
  return resposta ?? null;
}
