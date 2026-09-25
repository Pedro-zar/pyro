/**
 * Conjuração de Mente: quem lança decide, quem é atingido resiste.
 *
 * O mago escolhe as condições e os turnos de cada uma na janela (ver
 * apps/mente.mjs) e manda o card. A escolha não vale ainda: cada alvo rola
 * contra a DT da magia, com o que ela pedir, e só se falhar clica para
 * receber o que foi escolhido.
 *
 * Mora fora da janela porque o segundo tempo acontece em outro cliente — a
 * janela é do conjurador, os dois cards são do alvo.
 */

import { PYRO } from "./config.mjs";
import { esc } from "./ui.mjs";
import { aplicarCondicaoMental } from "./condicoes.mjs";
import {
  rolarResistencia, textoDaResistencia, textoDasResistencias, opcoesDeResistencia
} from "./resistencia.mjs";
import { flagsDoSistema } from "./sistema.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** O atributo que resiste à Mente: a mesma SAB de que sai a DT da magia. */
export const ATRIBUTO_RESISTENCIA = "sab";

/** As condições escolhidas, em linhas de texto ("Irritado por 2 turno(s)"). */
function linhasDasCondicoes(condicoes) {
  return condicoes.map(c => loc("PYRO.Mente.Linha", {
    condicao: loc(PYRO.condicoes[c.chave]?.label ?? c.chave), turnos: c.turnos
  }));
}

/**
 * Card do conjurador: o que ele escolheu e um botão de resistir por alvo.
 *
 * Um botão por alvo, e não um só para quem estiver selecionado: quem rola é o
 * jogador do alvo, e ele não precisa ter o token certo na mão para achar a
 * própria linha.
 */
export async function cardDeConjuracaoMental(actor, { condicoes, dt, alvos, resistencias = [] }) {
  const botoes = alvos.map(alvo => `
    <button type="button" class="pyro-resistir-mente" data-ator-uuid="${alvo.uuid}">
      <i class="fa-solid fa-brain"></i> ${loc("PYRO.Mente.Resistir", { nome: esc(alvo.name) })}
    </button>`).join("");

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="pyro-chat pyro-mente-card">
      <p><strong>${loc("PYRO.Mente.Titulo")}</strong></p>
      <ul>${linhasDasCondicoes(condicoes).map(l => `<li>${l}</li>`).join("")}</ul>
      <p class="pyro-nota">${loc("PYRO.Mente.ComoResistir", {
        dt,
        // Nome de perícia é texto escrito na ficha da magia: vai escapado.
        como: esc(textoDasResistencias(resistencias)
          || textoDaResistencia({ atributo: ATRIBUTO_RESISTENCIA }))
      })}</p>
      <div class="pyro-mente-alvos">${botoes}</div>
    </div>`,
    flags: flagsDoSistema({ mente: { condicoes, dt, resistencias } })
  });
}

/**
 * O teste do alvo contra a DT da magia. Passando, nada acontece; falhando, o
 * card traz o botão que aplica o que o conjurador escolheu — a condição entra
 * na ficha de quem a sofreu, e não pelas mãos de quem lançou.
 *
 * Com o que se resiste é da magia (ver MagiaData.resistencias): "Vontade (SAB)"
 * numa que peça a perícia, o atributo puro numa que não peça. Com mais de uma
 * opção, quem escolhe é quem rola.
 *
 * @returns {Promise<boolean>} false quando o diálogo foi cancelado.
 */
export async function resistirMente(actor, { dt = 0, condicoes = [], resistencias = [] } = {}) {
  // O botão é do alvo, na ficha do alvo: é ele quem recebe a condição.
  const naFalha = `<div class="pyro-mente-aplicar">
    <p>${loc("PYRO.Mente.Falhou")}</p>
    <ul>${linhasDasCondicoes(condicoes).map(l => `<li>${l}</li>`).join("")}</ul>
    <button type="button" class="pyro-aplicar-mente" data-ator-uuid="${actor?.uuid}">
      <i class="fa-solid fa-brain"></i> ${loc("PYRO.Mente.Aplicar")}
    </button>
  </div>`;

  const passou = await rolarResistencia(actor, {
    nd: dt,
    // Sem perícia declarada na magia, resiste-se com o atributo de sempre.
    opcoes: opcoesDeResistencia(resistencias).length
      ? resistencias : [{ pericia: "", atributo: ATRIBUTO_RESISTENCIA }],
    titulo: "PYRO.Mente.TituloResistir",
    dica: loc("PYRO.Mente.DicaResistir", { condicoes: linhasDasCondicoes(condicoes).join(", ") }),
    naFalha,
    noSucesso: `<p class="pyro-nota">${loc("PYRO.Mente.Resistiu")}</p>`,
    // O card do teste leva a escolha junto: é dele que o botão de aplicar a
    // lê, e assim ela sobrevive ao card da conjuração ser apagado.
    flags: { mente: { condicoes, dt, resistencias } }
  });
  return passou !== null;
}

/**
 * Põe na ficha as condições que o conjurador escolheu. Devolve as linhas do
 * que entrou, para o aviso dizer o que mudou.
 */
export async function aplicarMentaisEscolhidas(actor, condicoes) {
  const aplicadas = [];
  for (const { chave, turnos } of condicoes) {
    if (!PYRO.condicoesMentais[chave]) continue;
    await aplicarCondicaoMental(actor, chave, turnos);
    aplicadas.push({ chave, turnos });
  }
  return linhasDasCondicoes(aplicadas);
}
