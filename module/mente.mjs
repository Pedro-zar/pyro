/**
 * Conjuração de Mente: quem lança decide, quem é atingido resiste.
 *
 * O mago escolhe as condições e os turnos de cada uma na janela (ver
 * apps/mente.mjs) e manda o card. A escolha não vale ainda: cada alvo rola SAB
 * contra a DT da magia e, só se falhar, clica para receber o que foi escolhido.
 *
 * Mora fora da janela porque o segundo tempo acontece em outro cliente — a
 * janela é do conjurador, os dois cards são do alvo.
 */

import { PYRO } from "./config.mjs";
import { formulaTeste, poolDoAtributo } from "./dados.mjs";
import { classificarRolagem, poolDoTeste, htmlClasseDaRolagem, flagsDaClasse } from "./progressao.mjs";
import { formularioDoAtor, esc } from "./ui.mjs";
import { aplicarCondicaoMental, dicaMental } from "./condicoes.mjs";
import {
  camposDeTeste, aplicarExaustaoNoTeste, aplicarVontadeNoTeste, valorComInspiracao,
  htmlVontadeGasta, sufixoND
} from "./teste.mjs";
import { htmlFalhaAutomatica, htmlResultadoND } from "./chat.mjs";
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
export async function cardDeConjuracaoMental(actor, { condicoes, dt, alvos }) {
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
        dt, atributo: loc(PYRO.atributos[ATRIBUTO_RESISTENCIA])
      })}</p>
      <div class="pyro-mente-alvos">${botoes}</div>
    </div>`,
    flags: flagsDoSistema({ mente: { condicoes, dt } })
  });
}

/**
 * O teste do alvo: SAB contra a DT da magia. Passando, nada acontece;
 * falhando, o card traz o botão que aplica o que o conjurador escolheu — a
 * condição entra na ficha de quem a sofreu, e não pelas mãos de quem lançou.
 *
 * @returns {Promise<boolean>} false quando o diálogo foi cancelado.
 */
export async function resistirMente(actor, { dt = 0, condicoes = [] } = {}) {
  // Sem ser dono da ficha, a janela pediria Força de Vontade que o servidor
  // recusaria na hora de gravar.
  if (!actor?.isOwner) {
    ui.notifications.warn(loc("PYRO.Avisos.SemPermissao", { nome: actor?.name ?? "" }));
    return false;
  }
  const chave = ATRIBUTO_RESISTENCIA;
  const attr = actor.system.atributos?.[chave];
  // Ficha sem atributos (um grupo, por exemplo) não tem como resistir a nada.
  if (!attr) {
    ui.notifications.warn(loc("PYRO.Mente.SemAtributos", { nome: actor.name }));
    return false;
  }
  const nd = Math.max(0, Math.round(Number(dt) || 0));
  // DT zero não mede nada, e um card dizendo "aguentou" sem dificuldade
  // nenhuma faria a mesa acreditar num teste que não houve.
  if (!nd) {
    ui.notifications.warn(loc("PYRO.Mente.SemDt"));
    return false;
  }
  const rotulo = loc(PYRO.atributos[chave]);

  const res = await formularioDoAtor(actor, {
    titulo: loc("PYRO.Mente.TituloResistir"),
    conteudo: camposDeTeste(actor, {
      dica: [
        loc("PYRO.Mente.DicaResistir", { condicoes: linhasDasCondicoes(condicoes).join(", ") }),
        dicaMental(actor, chave)
      ].filter(Boolean).join(" "),
      // O ND é a DT de quem conjurou: quem resiste não mexe nele.
      nd, ndFixo: true
    }),
    rotuloOk: "PYRO.Rolar"
  });
  if (!res) return false;

  const opts = { ...res, nd: Number(res.nd) || 0 };
  aplicarExaustaoNoTeste(actor, opts, chave);

  /*
   * A classe da rolagem é medida antes da Força de Vontade entrar (SRD 3b):
   * o ponto gasto compra o resultado, não a dificuldade do que foi tentado.
   */
  const ndEscrito = opts.nd;
  const classe = ndEscrito
    ? classificarRolagem({ ...poolDoTeste(poolDoAtributo(attr.total), opts), nd: ndEscrito })
    : null;

  const vontade = await aplicarVontadeNoTeste(actor, res);
  opts.vantagem += vontade.beneficio;

  const formula = formulaTeste(valorComInspiracao(attr.total, vontade), opts);
  // Pool zerada por desvantagens: falha sem rolar (mesma regra dos testes).
  const roll = formula === null ? null : await new Roll(formula).evaluate();
  const resistiu = !!roll && roll.total >= ndEscrito;

  /*
   * Sem rolagem o card já diz "falha automática": repetir "falhou" acima
   * seria a mesma notícia duas vezes (como na sobrecarga).
   */
  const partes = [
    roll ? htmlResultadoND(resistiu) : "",
    roll ? await roll.render() : htmlFalhaAutomatica()
  ];
  if (resistiu) {
    partes.push(`<p class="pyro-nota">${loc("PYRO.Mente.Resistiu")}</p>`);
  } else {
    // O botão é do alvo, na ficha do alvo: é ele quem recebe a condição.
    partes.push(`<div class="pyro-mente-aplicar">
      <p>${loc("PYRO.Mente.Falhou")}</p>
      <ul>${linhasDasCondicoes(condicoes).map(l => `<li>${l}</li>`).join("")}</ul>
      <button type="button" class="pyro-aplicar-mente" data-ator-uuid="${actor.uuid}">
        <i class="fa-solid fa-brain"></i> ${loc("PYRO.Mente.Aplicar")}
      </button>
    </div>`);
  }
  partes.push(htmlClasseDaRolagem(classe), htmlVontadeGasta(vontade));

  /*
   * Sem o botão de Sorte, de propósito: é este resultado que decide se o
   * botão de aplicar aparece, e re-rolar o dado deixaria o botão falando de
   * um resultado que não existe mais.
   */
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: loc("PYRO.Mente.FlavorResistir", { atributo: rotulo }) + sufixoND(ndEscrito),
    content: `<div class="pyro-chat pyro-teste">${partes.join("")}</div>`,
    rolls: roll ? [roll] : [],
    flags: flagsDoSistema({
      mente: { condicoes, dt: ndEscrito },
      ...(classe ? flagsDaClasse(classe) : {})
    }),
    ...(roll ? { sound: CONFIG.sounds.dice } : {})
  });
  return true;
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
