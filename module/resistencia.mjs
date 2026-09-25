/**
 * Teste de resistência: o alvo rola contra uma dificuldade que não é dele.
 *
 * É o outro lado da magia. A DT sai de quem conjura, e o que o alvo rola sai
 * da magia também — "Vontade (SAB)" numa de mente, "Atletismo (FOR)" num
 * empurrão de vento. A perícia é procurada pelo nome na ficha de quem
 * resiste; quem não a tem rola sem treino, com o ND dobrado acima de 10, como
 * em qualquer perícia do sistema.
 *
 * Mora fora do card da magia porque o teste acontece em outro cliente: o card
 * é de quem conjurou, o teste é de quem foi atingido.
 */

import { PYRO } from "./config.mjs";
import { formulaTeste, poolDoAtributo } from "./dados.mjs";
import {
  classificarRolagem, poolDoTeste, htmlClasseDaRolagem, flagsDaClasse, ndAjustado
} from "./progressao.mjs";
import { formularioDoAtor, esc } from "./ui.mjs";
import { dicaMental, dicaMentais } from "./condicoes.mjs";
import {
  campoCheckbox, campoSelect, camposDeTeste, aplicarExaustaoNoTeste, aplicarVontadeNoTeste,
  valorComInspiracao, htmlVontadeGasta, textoDoND, periciaPorNome, ajudaDaPericia
} from "./teste.mjs";
import { htmlFalhaAutomatica, htmlResultadoND } from "./chat.mjs";
import { flagsDoSistema } from "./sistema.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/**
 * Como se resiste a esta magia, em texto ("Vontade (Sabedoria)"). Sem perícia
 * escrita, só o atributo.
 */
export function textoDaResistencia({ pericia = "", atributo = "sab" } = {}) {
  const rotulo = loc(PYRO.atributos[atributo] ?? PYRO.atributos.sab);
  return pericia?.trim() ? `${pericia.trim()} (${rotulo})` : rotulo;
}

/**
 * As opções que valem de verdade: entrada sem perícia escrita não é opção
 * nenhuma, e uma lista vazia é magia que só anuncia a DT.
 */
export const opcoesDeResistencia = lista =>
  (Array.isArray(lista) ? lista : []).filter(o => o?.pericia?.trim());

/** "Atletismo (Força) ou Reflexos (Agilidade)", para a linha da DT. */
export function textoDasResistencias(lista) {
  const partes = opcoesDeResistencia(lista).map(textoDaResistencia);
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} ${loc("PYRO.Resistencia.Ou")} ${partes.at(-1)}`;
}

/**
 * Rola a resistência e publica o card. O ND vem travado: quem resiste não
 * mexe no número de quem atacou.
 *
 * Com mais de uma opção, quem escolhe é quem rola: o vento que derruba aceita
 * Atletismo de quem se firma e Reflexos de quem sai da frente, e a escolha é
 * do alvo, não da magia.
 *
 * @param {number} args.nd a DT da magia.
 * @param {Array<{pericia: string, atributo: string}>} [args.opcoes] com o que
 *   dá para resistir. Vazio é teste do atributo padrão, sem perícia.
 * @param {string} [args.titulo] título da janela.
 * @param {string} [args.dica] linha de contexto antes dos campos.
 * @param {string} [args.naFalha] HTML que o card acrescenta quando o alvo
 *   não resiste — é por onde a conjuração de mente pendura o botão dela.
 * @param {string} [args.noSucesso] HTML para quando resiste.
 * @param {object} [args.flags] flags a mais no card do teste.
 * @returns {Promise<boolean|null>} null quando o diálogo foi cancelado,
 *   senão se o alvo resistiu.
 */
export async function rolarResistencia(actor, {
  nd, opcoes = [], titulo = "PYRO.Resistencia.Titulo",
  dica = "", naFalha = "", noSucesso = "", flags = {}
} = {}) {
  // Sem ser dono da ficha, a janela pediria Força de Vontade que o servidor
  // recusaria na hora de gravar.
  if (!actor?.isOwner) {
    ui.notifications.warn(loc("PYRO.Avisos.SemPermissao", { nome: actor?.name ?? "" }));
    return null;
  }
  // Ficha sem atributos (um grupo, por exemplo) não tem como resistir a nada.
  if (!actor.system?.atributos) {
    ui.notifications.warn(loc("PYRO.Resistencia.SemAtributos", { nome: actor.name }));
    return null;
  }
  const ndEscrito = Math.max(0, Math.round(Number(nd) || 0));
  // DT zero não mede nada, e um card dizendo "resistiu" sem dificuldade
  // nenhuma faria a mesa acreditar num teste que não houve.
  if (!ndEscrito) {
    ui.notifications.warn(loc("PYRO.Resistencia.SemDt"));
    return null;
  }

  /*
   * Sem opção escrita, o teste é do atributo padrão e mais nada — é o que a
   * conjuração de mente faz numa magia que não nomeia perícia.
   */
  const validas = opcoesDeResistencia(opcoes);
  const lista = validas.length ? validas : [{ pericia: "", atributo: "sab" }];
  const escolher = lista.length > 1;

  /** O que cada opção empresta ao teste, já procurada na ficha do alvo. */
  const ajuda = lista.map(o => {
    const nome = o.pericia?.trim() ?? "";
    const daPericia = ajudaDaPericia(
      nome ? periciaPorNome(actor, PYRO.normalizarTexto(nome)) : null);
    return { ...daPericia, nome, atributo: PYRO.atributos[o.atributo] ? o.atributo : "sab" };
  });

  /*
   * Uma linha por opção quando há escolha: é antes de escolher que o jogador
   * precisa saber em qual delas tem treino e em qual o ND dobra. Com uma só,
   * a linha é a de sempre.
   */
  const linhaDaOpcao = a => {
    // O nome vem da ficha da magia, escrito pela mesa: vai escapado.
    const dela = a.dica || (a.nome ? loc("PYRO.Resistencia.SemPericia", { nome: esc(a.nome) }) : "");
    if (!escolher) return dela;
    return `${esc(textoDaResistencia({ pericia: a.nome, atributo: a.atributo }))}: ${dela}`;
  };

  const res = await formularioDoAtor(actor, {
    titulo: loc(titulo),
    conteudo: (escolher
      ? campoSelect("resistencia", "PYRO.Resistencia.ComQue",
          Object.fromEntries(lista.map((o, i) => [String(i), esc(textoDaResistencia(o))])), "0")
      : "")
      + camposDeTeste(actor, {
        dica: [
          dica,
          ...ajuda.map(linhaDaOpcao),
          /*
           * Com a escolha dentro da janela, a dica lista TODAS as condições
           * mentais em curso: o jogador precisa ver qual opção custa um dado
           * antes de escolher.
           */
          escolher ? dicaMentais(actor) : dicaMental(actor, ajuda[0].atributo)
        ].filter(Boolean).join("<br>"),
        /*
         * Perícia que exige ferramentas dobra o ND sem elas, aqui como na
         * ficha. Com várias opções a caixa aparece se alguma exigir, e só
         * pesa se a escolhida for uma dessas.
         */
        extras: ajuda.some(a => a.pericia?.system?.exigeFerramentas)
          ? campoCheckbox("semFerramentas", "PYRO.Pericia.SemFerramentas") : "",
        // O ND é a DT de quem conjurou: quem resiste não mexe nele.
        nd: ndEscrito, ndFixo: true
      }),
    rotuloOk: "PYRO.Rolar"
  });
  if (!res) return null;

  const daPericia = ajuda[escolher ? (Number(res.resistencia) || 0) : 0] ?? ajuda[0];
  const nome = daPericia.nome;
  const chave = daPericia.atributo;
  const attr = actor.system.atributos[chave];

  const opts = { ...res, nd: ndEscrito };
  aplicarExaustaoNoTeste(actor, opts, chave);
  opts.bonus += daPericia.bonus;
  opts.vantagem += daPericia.vantagens;

  /*
   * A classe da rolagem é medida antes da Força de Vontade entrar (SRD 3b):
   * o ponto gasto compra o resultado, não a dificuldade do que foi tentado.
   */
  const classe = classificarRolagem({
    ...poolDoTeste(poolDoAtributo(attr.total), opts), nd: ndEscrito
  });

  const vontade = await aplicarVontadeNoTeste(actor, res);
  opts.vantagem += vontade.beneficio;

  // Sem a perícia aprendida, a DT pesa o dobro acima de 10.
  const ndFinal = nome ? ndAjustado(ndEscrito, {
    semTreino: !daPericia.aprendida,
    semFerramentas: !!daPericia.pericia?.system?.exigeFerramentas && !!res.semFerramentas
  }) : ndEscrito;
  const formula = formulaTeste(valorComInspiracao(attr.total, vontade), opts);
  // Pool zerada por desvantagens: falha sem rolar (mesma regra dos testes).
  const roll = formula === null ? null : await new Roll(formula).evaluate();
  const passou = !!roll && roll.total >= ndFinal;
  const contaUso = !daPericia.pericia?.system?.contaSoSucesso || passou;

  /*
   * Sem rolagem o card já diz "falha automática": repetir "falhou" acima
   * seria a mesma notícia duas vezes.
   */
  const partes = [
    roll ? htmlResultadoND(passou) : "",
    roll ? await roll.render() : htmlFalhaAutomatica(),
    passou ? noSucesso : naFalha,
    /*
     * A perícia que salvou (ou tentou) também é treinada pelo teste — menos
     * quando ela só progride com sucesso, e o alvo não resistiu.
     */
    htmlClasseDaRolagem(classe, contaUso ? daPericia.pericia : null),
    htmlVontadeGasta(vontade)
  ];

  /*
   * Sem o botão de Sorte, de propósito: é este resultado que decide o que o
   * card oferece depois, e re-rolar o dado deixaria a oferta falando de um
   * resultado que não existe mais.
   */
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: loc("PYRO.Resistencia.Flavor", { como: esc(textoDaResistencia({ pericia: nome, atributo: chave })) })
      + textoDoND(ndEscrito, ndFinal),
    content: `<div class="pyro-chat pyro-teste">${partes.filter(Boolean).join("")}</div>`,
    rolls: roll ? [roll] : [],
    flags: flagsDoSistema({
      ...flags, ...flagsDaClasse(classe, contaUso ? daPericia.pericia : null)
    }),
    ...(roll ? { sound: CONFIG.sounds.dice } : {})
  });
  return passou;
}

/**
 * Bloco do card da magia: a DT e, quando a magia pede, o botão de resistir.
 *
 * Um botão só, mesmo com várias opções: a escolha é feita na janela do teste,
 * onde o jogador vê em qual delas tem treino. Um botão por opção encheria o
 * card — e no card da conjuração de mente, que já tem um por alvo, viraria
 * uma grade.
 */
export function htmlLinhaDeDT(nd, resistencias, extra = "") {
  const linha = `<p class="pyro-dt">${loc("PYRO.Magia.DT", { valor: nd })}${extra}</p>`;
  const opcoes = opcoesDeResistencia(resistencias);
  if (!opcoes.length) return linha;
  return `<div class="pyro-resistencia">
    ${linha}
    <button type="button" class="pyro-rolar-resistencia">
      <i class="fa-solid fa-shield-halved"></i>
      ${loc("PYRO.Resistencia.Botao", { como: esc(textoDasResistencias(opcoes)) })}
    </button>
  </div>`;
}
