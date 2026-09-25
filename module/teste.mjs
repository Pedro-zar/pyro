/**
 * Diálogo de teste: os campos que toda rolagem de pool oferece e o que é
 * descontado dela antes de rolar — a exaustão e a Força de Vontade gasta.
 *
 * Vive fora de actor.mjs porque a mira mora no item e passa pelos mesmos
 * campos: teste é teste, venha da ficha ou de uma arma.
 */
import { PYRO } from "./config.mjs";
import { penalidadeExaustao, dicaExaustao } from "./efeitos.mjs";
import { desvantagemMental } from "./condicoes.mjs";
import { bonusPorNivel } from "./progressao.mjs";

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
 * @param {boolean} [opcoes.ndFixo] o ND não é de quem rola. Na mira e na
 *   sobrecarga quem edita o número é quem se prejudica com ele; num teste de
 *   resistir, o número é de quem atacou, e o campo só mostra.
 * @param {boolean} [opcoes.comVontade] false onde não há rolagem a comprar —
 *   oferecer o gasto num diálogo que não rola nada é prometer o que não se cumpre.
 */
export function camposDeTeste(actor, {
  dica = "", extras = "", comInspiracao = true, comVontade = true, nd = null, ndFixo = false
} = {}) {
  const avisoExaustao = dicaExaustao(actor);
  const campoND = nd === null
    ? `<input type="number" name="nd" placeholder="—">`
    : `<input type="number" name="nd" value="${nd}" min="0"${ndFixo ? " readonly" : ""}>`;
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

/**
 * Normaliza os números do formulário e desconta do teste o que o personagem
 * carrega: a exaustão (SRD Atributos) e a condição mental que pesa sobre o
 * atributo deste teste.
 *
 * @param {string} [atributo] o atributo que a pool usa. Sem ele, só a
 *   exaustão entra — é o caso das reações, que rolam pool fixa.
 */
export function aplicarExaustaoNoTeste(actor, opts, atributo = null) {
  const pen = penalidadeExaustao(actor);
  opts.bonus = (Number(opts.bonus) || 0) + pen.bonus;
  opts.vantagem = Number(opts.vantagem) || 0;
  opts.desvantagem = (Number(opts.desvantagem) || 0) + pen.desvantagem
    + (atributo ? desvantagemMental(actor, atributo) : 0);
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

/**
 * O ND que o card anuncia. Quando o teste ajustou a dificuldade — sem treino,
 * sem as ferramentas —, a linha mostra o caminho ("ND 14 → 18, sem treino"):
 * ver só o número final faz parecer que o mestre inventou outro ND.
 * @param {number} escrito o ND que foi pedido (a distância, na mira).
 * @param {number} final o ND que a rolagem de fato teve que alcançar.
 * @param {string} [motivo] o que ajustou; por padrão, a falta de treino.
 */
export function textoDoND(escrito, final, motivo = null) {
  if (!escrito) return "";
  if (final === escrito) return sufixoND(final);
  return ` (ND ${escrito} → ${final}, ${motivo || loc("PYRO.Pericia.SemTreinoTag")})`;
}

/* -------------------------------------------------------------------------- */
/*  Sobrecarga                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A perícia de um nome, se o personagem tiver uma.
 *
 * Ela é achada pelo NOME, como as regras de progressão e o sentido espiritual:
 * a mesa cria a perícia e ela passa a valer sozinha, sem campo escondido para
 * marcar. Sem ela o teste continua acontecendo, como qualquer teste sem treino
 * (SRD 3b): o ND dobra acima de 10.
 */
export function periciaPorNome(actor, nome) {
  return actor?.items?.find(item => item.type === "pericia"
    && PYRO.normalizarTexto(item.name) === nome) ?? null;
}

/** A perícia que cobre o teste de sobrecarga da magia e da técnica. */
export const periciaDeSobrecarga = actor =>
  periciaPorNome(actor, PYRO.NOME_PERICIA_SOBRECARGA);

/** A perícia que cobre o teste de mira do tiro à distância. */
export const periciaDeMira = actor => periciaPorNome(actor, PYRO.NOME_PERICIA_MIRA);

/**
 * Esta perícia é uma das que o sistema conduz por conta própria?
 *
 * Sobrecarga e Mirar têm janela própria, com os campos que a regra delas pede
 * (o preço da falha, a distância do alvo). Abertas na ficha elas precisam cair
 * na mesma janela do botão do chat, e não no diálogo genérico de perícia.
 */
export const ehPericiaDeRegra = (item, nome) =>
  item?.type === "pericia" && PYRO.normalizarTexto(item.name) === nome;

/**
 * O que uma dessas perícias empresta ao teste: bônus e vantagens por nível, e
 * se ela foi aprendida — é isso que decide o ND dobrado de quem não tem treino.
 * Também devolve a linha que o diálogo mostra, para o jogador ver de onde veio
 * o número antes de rolar.
 */
export function ajudaDaPericia(pericia) {
  const nivel = pericia?.system?.progresso?.nivel ?? 0;
  const porNivel = bonusPorNivel(nivel);
  const aprendida = !!pericia?.system?.aprendida;
  const dica = !pericia ? ""
    : nivel ? game.i18n.format("PYRO.Pericia.DicaNivel",
        { nivel, bonus: porNivel.bonus, vantagens: porNivel.vantagens })
    : loc("PYRO.Pericia.DicaSemTreino");
  return { pericia, aprendida, dica, ...porNivel };
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

/**
 * O botão que abre o teste de mira a partir do card do ataque.
 *
 * Mesmo desenho do de sobrecarga, e pelo mesmo motivo: o tiro já saiu e o dano
 * já está rolado — quem atirou é que decide quando encarar o dado da pontaria,
 * e é no diálogo que ele confere a distância, soma o que a mesa concedeu e
 * gasta Força de Vontade.
 *
 * @param {object} dados
 * @param {string} dados.atorUuid quem atira.
 * @param {string} dados.itemUuid o que foi usado — a arma, a técnica ou a
 *   magia. O card do teste sai em nome dele.
 * @param {number|string} [dados.distancia] a distância medida na hora do tiro;
 *   vazia quando não havia alvo marcado, e aí o diálogo mede de novo.
 * @param {number} dados.limite até onde o tiro acerta sem teste.
 * @param {number} [dados.alcance] até onde o ataque é confortável: dentro
 *   dele o teste ganha uma vantagem, fora dele uma desvantagem.
 * @param {string} dados.motivo linha que o card mostra acima do botão.
 */
export function htmlBotaoMira({ atorUuid, itemUuid, distancia = "", limite = 2, alcance = 0, motivo }) {
  return `<div class="pyro-mira pendente">
    <p>${motivo}</p>
    <button type="button" class="pyro-teste-mira"
            data-ator-uuid="${atorUuid}" data-item-uuid="${itemUuid}"
            data-distancia="${distancia}" data-limite="${limite}" data-alcance="${alcance}">
      <i class="fa-solid fa-crosshairs"></i> ${loc("PYRO.Mira.Botao")}
    </button>
  </div>`;
}

/**
 * Distância em metros entre o token do ator e o alvo marcado (se houver).
 * Retorna null quando não dá pra medir (sem token ou sem alvo).
 */
export function distanciaAteAlvo(actor) {
  try {
    const origem = actor?.getActiveTokens(true)[0];
    const alvo = game.user.targets.first();
    if (!origem || !alvo || origem === alvo) return null;
    const medida = canvas.grid.measurePath([origem.center, alvo.center]);
    return Math.round(medida.distance);
  } catch (e) {
    console.warn("PYRO | Não foi possível medir a distância até o alvo", e);
    return null;
  }
}

/**
 * O ataque precisa de teste de mira?
 *
 * A pergunta é a mesma para arma, técnica e magia, e a resposta sai da
 * distância: com um alvo marcado além da zona livre da criatura (quatro vezes
 * o alcance do corpo), qualquer ataque pede pontaria. Sem alvo marcado não há
 * o que medir, e aí só pede o ataque que tem como chegar além dessa zona —
 * uma espada num médio nunca pede, um arco sempre.
 *
 * @param {number} [alcance] até onde este ataque chega, para o caso sem alvo.
 * @returns {{pede: boolean, distancia: number|null, limite: number}}
 */
export function conferirMira(actor, alcance = 0) {
  const limite = actor?.system?.miraLivre ?? PYRO.miraLivre("medio");
  const distancia = actor ? distanciaAteAlvo(actor) : null;
  if (!actor) return { pede: false, distancia: null, limite };
  if (distancia !== null) return { pede: distancia > limite, distancia, limite };
  return { pede: alcance > limite, distancia: null, limite };
}

/** A linha que o card escreve acima do botão de mira. */
export function motivoDaMira({ distancia, limite }) {
  return distancia !== null
    ? loc("PYRO.Mira.Pendente", { distancia })
    : loc("PYRO.Mira.PendenteSemAlvo", { limite });
}
