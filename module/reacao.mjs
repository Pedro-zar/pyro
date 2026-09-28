/**
 * O dano que chega numa esquiva ou num bloqueio, escrito no diálogo da
 * reação.
 *
 * Em vez de um ND digitado à mão, quem reage escreve o golpe que vem: um
 * valor por tipo de dano, cada um aceitando conta (12 + 4, 30 / 2). A
 * defesa do personagem sai de cada tipo separadamente, como na aplicação de
 * dano do chat, e o que sobra é o ND real do teste. Assim a esquiva diz na
 * hora se escapou, e o bloqueio diz quanto ainda passa.
 */
import { PYRO } from "./config.mjs";
import { calcularFormula } from "./dados.mjs";
import { esc } from "./ui.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** Opções do tipo de dano: sem tipo primeiro, porque sem tipo não há defesa. */
function opcoesDeTipo(selecionado = "") {
  const opcoes = {
    "": loc("PYRO.Reacao.SemTipo"),
    ...Object.fromEntries(Object.entries(PYRO.tiposDano).map(([k, v]) => [k, loc(v.label)]))
  };
  return Object.entries(opcoes).map(([valor, rotulo]) =>
    `<option value="${valor}"${valor === selecionado ? " selected" : ""}>${esc(rotulo)}</option>`).join("");
}

/** Uma linha do dano: o valor (aceita conta) e o tipo dele. */
function linhaDeDano(indice) {
  return `<div class="pyro-dano-recebido-linha">
    <input type="text" name="danoRecebido.${indice}.valor" placeholder="0" inputmode="decimal" />
    <select name="danoRecebido.${indice}.tipo">${opcoesDeTipo()}</select>
    <button type="button" class="icone" data-pyro-remover-dano title="${esc(loc("PYRO.Excluir"))}">
      <i class="fa-solid fa-xmark"></i></button>
  </div>`;
}

/** O bloco do diálogo: o campo Dano, com uma linha por tipo e o botão de mais. */
export function camposDeDanoRecebido() {
  return `<fieldset class="pyro-dano-recebido">
    <legend>${loc("PYRO.Reacao.Dano")}
      <button type="button" class="icone" data-pyro-adicionar-dano title="${esc(loc("PYRO.Reacao.AdicionarTipo"))}">
        <i class="fa-solid fa-plus"></i></button>
    </legend>
    <div class="pyro-dano-recebido-linhas">${linhaDeDano(0)}</div>
  </fieldset>`;
}

/**
 * Liga os botões de mais e de tirar do bloco. Os índices só crescem: um
 * índice reaproveitado depois de tirar uma linha do meio juntaria duas
 * linhas no mesmo nome do formulário.
 */
export function ligarCamposDeDano(elemento) {
  const bloco = elemento?.querySelector(".pyro-dano-recebido");
  if (!bloco) return;
  const linhas = bloco.querySelector(".pyro-dano-recebido-linhas");
  let proximo = linhas.children.length;
  bloco.addEventListener("click", evento => {
    if (evento.target.closest("[data-pyro-adicionar-dano]")) {
      evento.preventDefault();
      linhas.insertAdjacentHTML("beforeend", linhaDeDano(proximo++));
      linhas.lastElementChild?.querySelector("input")?.focus();
      return;
    }
    const remover = evento.target.closest("[data-pyro-remover-dano]");
    if (remover) {
      evento.preventDefault();
      // A última linha fica: o campo Dano não some do diálogo.
      if (linhas.children.length > 1) remover.closest(".pyro-dano-recebido-linha")?.remove();
      else remover.closest(".pyro-dano-recebido-linha")?.querySelector("input")?.select();
    }
  });
}

/**
 * Lê as linhas do formulário e desconta a defesa de cada tipo.
 *
 * @param {object} resposta o objeto do formulário (chaves "danoRecebido.0.valor").
 * @param {Record<string, number>} defesas as defesas totais do personagem, por tipo.
 * @returns {{linhas: object[], total: number}|null} null quando nenhuma linha
 *   tem valor: aí a reação sai sem ND, como antes.
 */
export function lerDanoRecebido(resposta, defesas = {}) {
  const bruto = foundry.utils.expandObject(resposta ?? {}).danoRecebido ?? {};
  const linhas = [];
  for (const indice of Object.keys(bruto).sort((a, b) => Number(a) - Number(b))) {
    const { valor, tipo = "" } = bruto[indice] ?? {};
    const texto = String(valor ?? "").trim();
    if (!texto) continue;
    const dano = Math.max(0, Math.floor(calcularFormula(texto)));
    const defesa = tipo ? Math.max(0, Number(defesas?.[tipo]) || 0) : 0;
    linhas.push({ tipo, texto, dano, defesa, liquido: Math.max(0, dano - defesa) });
  }
  if (!linhas.length) return null;
  return { linhas, total: linhas.reduce((soma, l) => soma + l.liquido, 0) };
}

/**
 * A conta no card: cada tipo com a defesa descontada e o total que virou o
 * ND. "Cortante 12 - 3 = 9 · Calor 8 - 2 = 6 · ND 15".
 */
export function htmlContaDoDano(conta) {
  const partes = conta.linhas.map(l => {
    const rotulo = l.tipo ? loc(PYRO.tiposDano[l.tipo]?.label ?? l.tipo) : loc("PYRO.Reacao.SemTipo");
    return l.defesa
      ? `${esc(rotulo)} ${l.dano} − ${l.defesa} = ${l.liquido}`
      : `${esc(rotulo)} ${l.dano}`;
  });
  return `<p class="pyro-nota pyro-conta-dano">${partes.join(" · ")} · ${
    loc("PYRO.Reacao.DanoTotal", { total: conta.total })}</p>`;
}

/** O que ainda passa depois do bloqueio, e se ele segurou tudo. */
export function htmlDanoRestante(total, bloqueado) {
  const restante = Math.max(0, total - Math.max(0, Number(bloqueado) || 0));
  return `<p class="pyro-dano-restante ${restante ? "passa" : "segurou"}">${
    restante ? loc("PYRO.Reacao.Passa", { dano: restante }) : loc("PYRO.Reacao.Segurou")}</p>`;
}
