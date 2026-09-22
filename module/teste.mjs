/**
 * Diálogo de teste: os campos que toda rolagem de pool oferece e o que é
 * descontado dela antes de rolar — a exaustão e a Força de Vontade gasta.
 *
 * Vive fora de actor.mjs porque a mira mora no item e passa pelos mesmos
 * campos: teste é teste, venha da ficha ou de uma arma.
 */
import { PYRO } from "./config.mjs";
import { penalidadeExaustao, dicaExaustao } from "./efeitos.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

export const campoNumero = (nome, chave, valor = 0, min = null, max = null) => `
  <div class="form-group"><label>${loc(chave)}</label>
    <input type="number" name="${nome}" value="${valor}"${
      min === null ? "" : ` min="${min}"`}${max === null ? "" : ` max="${max}"`}></div>`;

export const campoSelect = (nome, chave, opcoes, selecionado) => `
  <div class="form-group"><label>${loc(chave)}</label>
    <select name="${nome}">${Object.entries(opcoes).map(([valor, rotulo]) =>
      `<option value="${valor}"${valor === selecionado ? " selected" : ""}>${rotulo}</option>`).join("")}</select></div>`;

export const campoCheckbox = (nome, chave, marcado = false) => `
  <div class="form-group"><label>${loc(chave)}</label>
    <input type="checkbox" name="${nome}"${marcado ? " checked" : ""}></div>`;

/** Pontos de Força de Vontade que o ator tem agora. */
export function vontadeDisponivel(actor) {
  return actor?.system?.recursos?.vontade?.value ?? 0;
}

/**
 * Campos de Força de Vontade do diálogo (SRD Atributos), gastos antes de rolar:
 *
 *   Benefício          até 3 pontos, cada um vale uma vantagem.
 *   Inspiração Divina  5 pontos, dobra o atributo daquela rolagem.
 *
 * Só aparecem quando há ponto para gastar, e a Inspiração só onde existe um
 * atributo para dobrar — numa reação a pool é fixa pelo sistema, não sai de
 * atributo nenhum.
 */
function camposDeVontade(actor, { comInspiracao }) {
  const pontos = vontadeDisponivel(actor);
  if (pontos <= 0) return "";
  const partes = [
    campoNumero("vontadeBeneficio", "PYRO.Vontade.Beneficio", 0, 0, Math.min(3, pontos))
  ];
  if (comInspiracao && pontos >= PYRO.CUSTO_INSPIRACAO) {
    partes.push(campoCheckbox("vontadeInspiracao", "PYRO.Vontade.Inspiracao"));
  }
  return `<p class="hint">${loc("PYRO.Vontade.Disponivel", { n: pontos })}</p>${partes.join("")}`;
}

/**
 * Campos comuns a todo teste (bônus, vantagens, desvantagens, ND), com o
 * aviso de exaustão no topo e a Força de Vontade no fim.
 * @param {string} [opcoes.dica] linha de contexto antes dos campos.
 * @param {string} [opcoes.extras] campos próprios do teste, antes da Vontade.
 * @param {boolean} [opcoes.comInspiracao] o teste tem um atributo para dobrar.
 * @param {number} [opcoes.nd] ND já conhecido (a mira sabe a distância); sem
 *   ele o campo abre vazio, porque na maioria dos testes quem define é o mestre.
 * @param {boolean} [opcoes.comVontade] false onde não há rolagem a comprar —
 *   oferecer o gasto num diálogo que não rola nada é prometer o que não se cumpre.
 */
export function camposDeTeste(actor, {
  dica = "", extras = "", comInspiracao = true, comVontade = true, nd = null
} = {}) {
  const avisoExaustao = dicaExaustao(actor);
  const campoND = nd === null
    ? `<input type="number" name="nd" placeholder="—">`
    : `<input type="number" name="nd" value="${nd}" min="0">`;
  return `
    ${avisoExaustao ? `<p class="hint">${avisoExaustao}</p>` : ""}
    ${dica ? `<p class="hint">${dica}</p>` : ""}
    ${campoNumero("bonus", "PYRO.Teste.Bonus")}
    ${campoNumero("vantagem", "PYRO.Teste.Vantagem", 0, 0)}
    ${campoNumero("desvantagem", "PYRO.Teste.Desvantagem", 0, 0)}
    <div class="form-group"><label>${loc("PYRO.Teste.ND")}</label>${campoND}</div>
    ${extras}
    ${comVontade ? camposDeVontade(actor, { comInspiracao }) : ""}`;
}

/** Normaliza os números do formulário e desconta a exaustão do ator (SRD Atributos). */
export function aplicarExaustaoNoTeste(actor, opts) {
  const pen = penalidadeExaustao(actor);
  opts.bonus = (Number(opts.bonus) || 0) + pen.bonus;
  opts.vantagem = Number(opts.vantagem) || 0;
  opts.desvantagem = (Number(opts.desvantagem) || 0) + pen.desvantagem;
}

/**
 * Cobra a Força de Vontade escolhida no diálogo e devolve o que ela comprou.
 * Não mexe nos ajustes do teste: quem chama decide onde aplicar o Benefício,
 * porque a classe da rolagem tem que ser medida antes dele entrar (SRD 3b).
 *
 * O gasto acontece antes de rolar, porque é assim na regra — o ponto foi
 * apostado, e o resultado do dado não o devolve. Sem ponto suficiente o
 * pedido é aparado até o que o personagem tem, em vez de recusado.
 *
 * @param {object} escolhas resposta do formulário (vontadeBeneficio, vontadeInspiracao).
 * @returns {Promise<{beneficio: number, inspiracao: boolean, gasto: number}>}
 */
export async function aplicarVontadeNoTeste(actor, escolhas) {
  let beneficio = Math.clamp(Math.round(Number(escolhas?.vontadeBeneficio) || 0), 0, 3);
  let inspiracao = !!escolhas?.vontadeInspiracao;
  const disponivel = vontadeDisponivel(actor);

  // A Inspiração é o gasto maior e tem prioridade: quem marcou os dois com
  // pouco ponto quis o efeito grande, e o Benefício é o que cede.
  if (inspiracao && disponivel < PYRO.CUSTO_INSPIRACAO) inspiracao = false;
  const restante = disponivel - (inspiracao ? PYRO.CUSTO_INSPIRACAO : 0);
  beneficio = Math.min(beneficio, Math.max(0, restante));

  const gasto = beneficio + (inspiracao ? PYRO.CUSTO_INSPIRACAO : 0);
  if (gasto > 0) {
    await actor.update({ "system.recursos.vontade.value": disponivel - gasto });
  }
  return { beneficio, inspiracao, gasto };
}

/**
 * O valor de atributo que a rolagem usa depois da Inspiração Divina: dobrado
 * (SRD Atributos — 10 de FOR rola como 20, 4d10 em vez de 3d6).
 */
export function valorComInspiracao(valor, vontade) {
  return vontade?.inspiracao ? valor * 2 : valor;
}

/** Linha do card contando o que a Vontade pagou; vazia quando não foi gasta. */
export function htmlVontadeGasta(vontade) {
  if (!vontade?.gasto) return "";
  const partes = [
    vontade.beneficio ? loc("PYRO.Vontade.BeneficioCard", { n: vontade.beneficio }) : null,
    vontade.inspiracao ? loc("PYRO.Vontade.InspiracaoCard") : null
  ].filter(Boolean);
  return `<p class="pyro-vontade-gasta"><i class="fa-solid fa-fire-flame-curved"></i>
    ${loc("PYRO.Vontade.Gastou", { n: vontade.gasto })} ${partes.join(" · ")}</p>`;
}

export const sufixoND = nd => (nd ? ` (ND ${nd})` : "");

/* -------------------------------------------------------------------------- */
/*  Sobrecarga                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A perícia que cobre o teste de sobrecarga, se o personagem tiver uma.
 *
 * Ela é achada pelo NOME, como as regras de progressão e o sentido espiritual:
 * a mesa cria a perícia "Sobrecarga" e ela passa a valer sozinha, sem campo
 * escondido para marcar. Sem a perícia o teste continua acontecendo, como
 * qualquer teste sem treino (SRD 3b): o ND dobra acima de 10.
 */
export function periciaDeSobrecarga(actor) {
  return actor?.items?.find(item => item.type === "pericia"
    && PYRO.normalizarTexto(item.name) === PYRO.NOME_PERICIA_SOBRECARGA) ?? null;
}

/**
 * O botão que abre o teste de sobrecarga a partir do card da conjuração ou da
 * execução. O teste não sai sozinho de propósito: quem escolheu passar do
 * limite é quem decide quando encarar o dado, e é no diálogo que ele gasta
 * Força de Vontade, soma o que a mesa concedeu e vê o ND já ajustado.
 *
 * @param {object} dados
 * @param {string} dados.atorUuid quem faz o teste.
 * @param {string} [dados.itemUuid] magia ou técnica, para o card do teste
 *   oferecer o "contar uso" dela — é o teste que mede a dificuldade (SRD).
 * @param {string} dados.atributo atributo do teste (SAB na magia, VIG na técnica).
 * @param {number} dados.nd dificuldade já calculada.
 * @param {number} dados.exaustao exaustão que a falha custa.
 * @param {number} [dados.bonusAtributo] o que um efeito preso ao item soma ao
 *   atributo do teste ("+2 VIG com a katana").
 * @param {string} dados.motivo linha que o diálogo e o card repetem.
 */
export function htmlBotaoSobrecarga({
  atorUuid, itemUuid = "", atributo, nd, exaustao, bonusAtributo = 0, motivo
}) {
  return `<div class="pyro-sobrecarga pendente">
    <p>${motivo}</p>
    <button type="button" class="pyro-teste-sobrecarga"
            data-ator-uuid="${atorUuid}" data-item-uuid="${itemUuid}"
            data-atributo="${atributo}" data-nd="${nd}" data-exaustao="${exaustao}"
            data-bonus-atributo="${bonusAtributo}">
      <i class="fa-solid fa-dice-d20"></i> ${loc("PYRO.Sobrecarga.Botao")}
    </button>
  </div>`;
}
