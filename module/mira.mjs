/**
 * Teste de mira: a janela, o card e o desvio do tiro errado (SRD §5).
 *
 * Mora fora do item porque nem sempre há um. Ele é pedido pelo card da arma,
 * da técnica e da magia, e também pela perícia Mirar aberta direto na ficha —
 * e nesse último caso não existe ataque nenhum de onde tirar o alcance. O que
 * todas as portas têm em comum é o ator, então é ele que o teste recebe.
 */

import { PYRO } from "./config.mjs";
import { formulaTeste, poolDoAtributo } from "./dados.mjs";
import { classificarRolagem, poolDoTeste, htmlClasseDaRolagem, ndAjustado } from "./progressao.mjs";
import { formularioDoAtor } from "./ui.mjs";
import { dicaMental } from "./condicoes.mjs";
import { alcanceDaArma } from "./efeitos.mjs";
import {
  campoCheckbox, camposDeTeste, aplicarExaustaoNoTeste, aplicarVontadeNoTeste,
  valorComInspiracao, htmlVontadeGasta, periciaDeMira, ajudaDaPericia, textoDoND,
  distanciaAteAlvo
} from "./teste.mjs";
import { htmlFalhaAutomatica } from "./chat.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/**
 * Ajustes que a distância impõe ao tiro (SRD §5): dentro do alcance
 * confortável do ataque o teste ganha uma vantagem, passando dele ganha uma
 * desvantagem. Além do alcance máximo não há tiro, mas o jogador ainda pode
 * digitar a distância — quem decide se a arma alcança é a mesa, e o teste sai
 * com a desvantagem do longe.
 *
 * Alcance nulo é alcance DESCONHECIDO, e não zero: é o caso da perícia aberta
 * na ficha, sem ataque nenhum por trás. Ali o teste sai limpo, e quem quiser
 * a vantagem ou a desvantagem escreve nos campos da janela.
 */
function ajusteDeAlcance(distancia, alcance) {
  if (alcance === null) return { vantagem: 0, desvantagem: 0, nota: "PYRO.Mira.SemAtaque" };
  /*
   * Ataque sem alcance confortável nenhum (o zero) sai sempre com
   * desvantagem. Isso é característica do ataque, não um caso esquecido:
   * uma arma de arremesso que deveria ter uma faixa boa precisa do alcance
   * menor preenchido, e uma magia sem alcance escrito não tem faixa.
   */
  if (alcance > 0 && distancia <= alcance) {
    return { vantagem: 1, desvantagem: 0, nota: "PYRO.Mira.NoPonto" };
  }
  return { vantagem: 0, desvantagem: 1, nota: "PYRO.Mira.Longe" };
}

/**
 * Onde o tiro errado foi parar (SRD §5). A direção sai de 1d12 lido como um
 * relógio a partir do ponto além do alvo — 1 é atrás dele, 7 é à frente, na
 * direção de quem atirou —, e a distância é metade do que faltou no teste.
 *
 * Um erro por 1 ponto não move o tiro meio metro: com a diferença abaixo de
 * 2 o desvio é de 1 metro, senão o tiro que quase acertou acertaria mesmo
 * assim, o que não é o que a regra descreve.
 */
async function desvioDoTiro(total, nd) {
  const direcao = await new Roll("1d12").evaluate();
  const metros = Math.ceil((nd - total) / 2);
  return { direcao, metros, hora: direcao.total };
}

/**
 * Janela do teste de mira: DES contra ND igual à distância em metros.
 * Com um alvo marcado, a distância e o ND já vêm preenchidos, e o ajuste do
 * alcance entra sozinho. Errar não perde o tiro: ele vai parar em outro
 * lugar, e o desvio é rolado aqui (SRD §5).
 *
 * Quem tem a perícia Mirar atira com ela: bônus e vantagens por nível entram
 * no teste, e quem não a aprendeu sofre o ND dobrado acima de 10, como em
 * qualquer perícia sem treino. O tiro também treina a perícia, então o card
 * traz o botão de contar o uso.
 */
async function janelaDeMira(actor, { limite, distanciaSugerida, alcance, pericia }) {
  // A medida do momento do tiro manda; sem ela, mede-se agora.
  const medida = Number.isFinite(distanciaSugerida)
    ? distanciaSugerida : distanciaAteAlvo(actor);
  // Sem alvo marcado, começa no primeiro metro que já pede teste.
  const distancia = medida ?? Math.max(limite + 1, alcance ?? 0);
  const ajuste = ajusteDeAlcance(distancia, alcance);

  // A perícia clicada manda; do card ela é procurada pelo nome.
  const mirar = ajudaDaPericia(pericia ?? periciaDeMira(actor));
  /*
   * A mira é um teste de DES por regra, e é esse o atributo que a perícia
   * nasce declarando. A mesa que trocar o atributo dela na ficha troca o
   * atributo do teste junto — é a única forma de a declaração significar
   * alguma coisa aqui.
   */
  const chave = mirar.pericia?.system?.atributos?.[0] ?? "des";
  const exigeFerramentas = !!mirar.pericia?.system?.exigeFerramentas;
  const dica = [
    medida !== null
      ? loc("PYRO.Mira.AlvoMarcado", { distancia: medida })
      : loc("PYRO.Mira.SemAlvoLimite", { limite }),
    loc(ajuste.nota),
    mirar.dica,
    dicaMental(actor, chave)
  ].filter(Boolean).join(" ");

  const res = await formularioDoAtor(actor, {
    titulo: loc("PYRO.Mira.Titulo"),
    // O ND da mira é a distância em metros, então ele já vem preenchido.
    conteudo: camposDeTeste(actor, {
      dica,
      nd: distancia,
      extras: `<div class="form-group"><label>${loc("PYRO.Mira.Distancia")}</label>
        <input type="number" name="distancia" value="${distancia}" min="0"></div>`
        + (exigeFerramentas ? campoCheckbox("semFerramentas", "PYRO.Pericia.SemFerramentas") : "")
    })
  });
  if (!res) return null;

  /*
   * O ajuste é recalculado com a distância que o jogador confirmou, e não
   * com a estimada: quem corrigiu o número para 3m depois de a janela abrir
   * em 12m está atirando de perto, e merece a vantagem do ponto.
   */
  const distanciaFinal = Number(res.distancia) || 0;
  const doAlcance = ajusteDeAlcance(distanciaFinal, alcance);
  const opts = { ...res, nd: Number(res.nd) || 0 };
  aplicarExaustaoNoTeste(actor, opts, chave);
  opts.vantagem += doAlcance.vantagem;
  opts.desvantagem += doAlcance.desvantagem;
  opts.bonus += mirar.bonus;
  opts.vantagem += mirar.vantagens;

  const atributo = actor?.system.atributos[chave];
  /*
   * A classe da rolagem é medida antes da Força de Vontade entrar (SRD 3b):
   * o ponto gasto compra o resultado, não a dificuldade do que foi tentado.
   */
  const ndEscrito = opts.nd;
  const classe = atributo && ndEscrito
    ? classificarRolagem({ ...poolDoTeste(poolDoAtributo(atributo.total), opts), nd: ndEscrito })
    : null;

  const vontade = await aplicarVontadeNoTeste(actor, res);
  opts.vantagem += vontade.beneficio;

  // Sem a perícia aprendida, a distância pesa o dobro acima de 10 metros.
  const nd = ndAjustado(ndEscrito, {
    semTreino: !mirar.aprendida,
    semFerramentas: exigeFerramentas && !!res.semFerramentas
  });
  const formula = atributo
    ? formulaTeste(valorComInspiracao(atributo.total, vontade), opts)
    : null;

  // Pool zerada por desvantagens: erra sem rolar (mesma regra dos testes).
  const roll = await new Roll(formula ?? "0").evaluate();
  const acertou = formula !== null && roll.total >= nd;
  return {
    roll, nd, vontade, classe,
    // Sem fórmula não houve rolagem: a pool inteira foi comida pelas
    // desvantagens, e o tiro erra sem dado (mesma regra dos testes).
    automatica: formula === null,
    // Perícia que só progride com sucesso não conta o uso numa falha.
    pericia: (!mirar.pericia?.system?.contaSoSucesso || acertou) ? mirar.pericia : null,
    textoND: textoDoND(ndEscrito, nd),
    distancia: distanciaFinal,
    acertou,
    desvio: acertou ? null : await desvioDoTiro(roll.total, nd)
  };
}

/**
 * Teste de mira, do botão do card ou da perícia aberta na ficha. Ele sai num
 * card próprio, como o de sobrecarga: o card do tiro já mostrou o dano, e
 * este mostra a pontaria — se acertou, para onde a flecha foi se errou, e o
 * botão de contar o uso da perícia.
 *
 * @param {Item} [opcoes.item] o que atacou. Só serve para o alcance, e só
 *   quando ele não vem pronto: aberto pela perícia não há item nenhum.
 * @param {Item} [opcoes.pericia] a perícia clicada, quando quem abriu foi ela.
 * @param {number|null} [opcoes.distancia] a medida do momento do tiro; sem
 *   ela o diálogo mede de novo.
 * @param {number} [opcoes.limite] até onde o tiro acerta sem teste.
 * @param {number} [opcoes.alcance] até onde o ataque é confortável; nulo
 *   quando não há ataque de onde tirá-lo.
 * @returns {Promise<boolean>} false quando o diálogo foi cancelado.
 */
export async function rolarMira(actor, { item = null, pericia = null, distancia = null,
                                         limite = null, alcance = null } = {}) {
  // Sem ficha, ou sem ser dono dela, não há teste: a janela pediria Força de
  // Vontade que o servidor recusaria na hora de gravar.
  if (!actor?.isOwner) return false;
  /*
   * O alcance confortável vem de quem montou o card, porque só ele sabe de
   * onde tirá-lo: da arma, do traço da técnica, do escalonamento da magia.
   * Uma arma clicada direto, sem card, ainda tem o dela; a perícia aberta na
   * ficha não tem nenhum, e aí o teste sai sem o ajuste.
   */
  const daArma = item?.type === "arma" ? alcanceDaArma(actor, item).menor : null;
  const mira = await janelaDeMira(actor, {
    // Sem limite informado, vale o da própria criatura (ver PYRO.miraLivre).
    limite: Number.isFinite(limite) ? limite : (actor.system?.miraLivre ?? PYRO.miraLivre("medio")),
    distanciaSugerida: distancia,
    alcance: Number.isFinite(alcance) ? alcance : daArma,
    pericia
  });
  if (!mira) return false;

  /*
   * Pool zerada pelas desvantagens: não há dado nenhum para mostrar, e o
   * card diz isso — um "0" renderizado pareceria uma rolagem que aconteceu.
   */
  const rolls = mira.automatica ? [] : [mira.roll];
  const partes = [
    `<p>${loc("PYRO.Mira.Resultado", { distancia: mira.distancia })}${mira.textoND}
      — <strong><i class="fa-solid ${mira.acertou ? "fa-check" : "fa-xmark"}"></i>
      ${loc(mira.acertou ? "PYRO.Mira.Acertou" : "PYRO.Mira.Errou")}</strong></p>`,
    mira.automatica ? htmlFalhaAutomatica() : await mira.roll.render()
  ];
  if (!mira.acertou) {
    /*
     * Errar não anula o tiro: ele cai em outro lugar, e o que estiver lá
     * vira o novo alvo (SRD §5). O dano já foi rolado no card do ataque — a
     * mesa só marca no mapa onde a flecha foi parar.
     */
    rolls.push(mira.desvio.direcao);
    partes.push(`<div class="pyro-desvio">
      <p>${loc("PYRO.Mira.Desvio", {
        hora: (mira.desvio.hora - 1) * 30, metros: mira.desvio.metros
      })}</p>
      ${await mira.desvio.direcao.render()}
      <p class="pyro-nota">${loc("PYRO.Mira.DesvioDica")}</p>
    </div>`);
  }
  partes.push(htmlClasseDaRolagem(mira.classe, mira.pericia), htmlVontadeGasta(mira.vontade));

  /*
   * Sem o botão de Sorte, de propósito: o desvio já foi calculado a partir
   * do que faltou para o ND, e re-rolar o dado deixaria a distância do erro
   * dizendo respeito a um resultado que não existe mais.
   */
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: loc("PYRO.Mira.Titulo"),
    // O bloco da mira vai DENTRO da casca do card: as regras dele são de
    // descendente (.pyro-chat .pyro-mira), e as duas classes no mesmo
    // elemento não casariam com nenhuma.
    content: `<div class="pyro-chat pyro-teste">
      <div class="pyro-mira ${mira.acertou ? "sucesso" : "falha"}">${partes.join("")}</div>
    </div>`,
    rolls,
    ...(rolls.length ? { sound: CONFIG.sounds.dice } : {})
  });
  return true;
}
