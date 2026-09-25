/**
 * Condições que se acumulam e passam com o tempo: Queimando, Molhado, Friagem
 * e as sete condições mentais.
 *
 * Todas guardam duas coisas nas flags do efeito — quantas pilhas e quantos
 * turnos faltam. O turno é a unidade porque é a única que o SRD fixa: ele vale
 * 6 segundos, enquanto a rodada estica conforme quanta gente está em cena
 * (ver PYRO.SEGUNDOS_POR_TURNO). Molhado é a exceção sem prazo: ele espera o
 * dano de frio que for chegar.
 */
import { PYRO } from "./config.mjs";
import { nivelExaustao } from "./efeitos.mjs";
import { SYSTEM_ID, flagsDe, naFila } from "./sistema.mjs";
import { SEM_PRAZO, dadosDePrazo, updateDePrazo, rotuloDePrazo } from "./duracao.mjs";
import { formulaPool } from "./dados.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

export { SEM_PRAZO };

/**
 * O efeito que carrega esta condição no ator, se houver.
 *
 * Também reconhece o efeito que o HUD do token criou: ele tem o status certo e
 * nenhuma flag nossa. Ignorá-lo faria o ícone aparecer sem que nada queimasse
 * ou expirasse, e o próximo botão criaria um segundo efeito igual.
 */
export function efeitoDaCondicao(actor, chave) {
  const efeitos = actor?.effects;
  if (!efeitos?.find) return null;
  return efeitos.find(e => flagsDe(e)?.condicao === chave)
    ?? efeitos.find(e => temStatus(e, chave) && ehDoHud(e))
    ?? null;
}

const temStatus = (efeito, chave) =>
  efeito?.statuses?.has?.(chave) ?? efeito?.statuses?.includes?.(chave) ?? false;

/**
 * Efeito acendido pelo HUD do token: só o ícone, sem nada dentro. Um efeito
 * montado no construtor que por acaso marque o mesmo status carrega bônus,
 * mudanças ou prazo próprios — adotá-lo renomearia a peça de outra pessoa e a
 * apagaria quando o prazo da condição vencesse.
 */
function ehDoHud(efeito) {
  return !flagsDe(efeito)
    && !efeito?.system?.changes?.length
    && !efeito?.changes?.length;
}

/**
 * Quantas pilhas da condição o ator tem agora. Condição ligada pelo HUD do
 * token não traz contagem: ela vale uma pilha, que é o que o mestre quis dizer
 * ao acender o ícone.
 */
export function pilhasDe(actor, chave) {
  const efeito = efeitoDaCondicao(actor, chave);
  if (!efeito) return 0;
  const flags = flagsDe(efeito);
  if (!flags?.condicao) return 1;
  return Math.max(0, Number(flags.pilhas) || 0);
}

/** Quantos turnos faltam para a condição acabar; null quando ela não tem prazo. */
export function turnosDe(actor, chave) {
  const efeito = efeitoDaCondicao(actor, chave);
  if (!efeito) return 0;
  const turnos = flagsDe(efeito)?.turnos;
  return turnos === null || turnos === undefined ? SEM_PRAZO : Number(turnos) || 0;
}

/** Nome que a condição mostra na ficha e no token, com a contagem de pilhas. */
function nomeDaCondicao(chave, pilhas, contaPilhas = true) {
  const nome = loc(PYRO.condicoes[chave]?.label ?? chave);
  return contaPilhas ? loc("PYRO.Condicoes.ComPilhas", { nome, n: pilhas }) : nome;
}

/**
 * Prazo que sobra quando uma aplicação nova encontra uma condição já ativa.
 * Sem prazo de um dos lados é sem prazo: a condição espera algo consumi-la.
 * Fora isso, o mais longo vence — nas mentais, onde cada ponto gasto compra um
 * turno, eles somam.
 */
function juntarPrazos(atual, novo, modo) {
  const antes = atual === null || atual === undefined ? SEM_PRAZO : Number(atual) || 0;
  if (novo === SEM_PRAZO || antes === SEM_PRAZO) return SEM_PRAZO;
  return modo === "soma" ? antes + novo : Math.max(antes, novo);
}

/**
 * Aplica ou reforça uma condição.
 *
 * Cada condição junta o que chega com o que já estava lá do seu próprio jeito,
 * e é isso que os dois modos descrevem:
 *
 *   pilhas "soma"  Queimando e Molhado acumulam — 2 pilhas mais 3 são 5.
 *   pilhas "maior" Friagem não acumula: fica a maior das duas, e uma aplicação
 *                  menor não muda nada, nem o prazo.
 *   pilhas "fixa"  condição mental não tem pilha: estar Irritado duas vezes é
 *                  estar irritado.
 *   prazo "maior"  o mais longo vence, e uma aplicação curta não encurta o que
 *                  já estava correndo.
 *   prazo "soma"   nas mentais, onde cada ponto gasto compra um turno.
 *
 * @param {number} pilhas quantas aplicar.
 * @param {number|null} turnos prazo desta aplicação; null é sem prazo.
 * @param {"maior"|"soma"} [opcoes.prazo] como o prazo novo encontra o antigo.
 * @param {"soma"|"maior"|"fixa"} [opcoes.pilhas] o mesmo, para as pilhas.
 * @param {number} [opcoes.entrada] turnos a mais só quando a condição entra
 *   agora no alvo (ver aplicarCondicaoMental).
 */
export function empilharCondicao(actor, chave, pilhas, turnos = SEM_PRAZO, {
  prazo: modoPrazo = "maior", pilhas: modoPilhas = "soma", entrada = 0
} = {}) {
  const soma = Math.max(0, Math.round(Number(pilhas) || 0));
  if (!actor || !soma || !PYRO.condicoes[chave]) return null;
  const contaPilhas = modoPilhas !== "fixa";

  return naFila(actor, async () => {
    const existente = efeitoDaCondicao(actor, chave);
    if (existente) {
      const flags = flagsDe(existente) ?? {};
      // Efeito adotado do HUD do token não tem nada gravado: a pilha dele é a
      // primeira (é o que o ícone já dizia na cena) e ele não trazia prazo
      // nenhum, então quem manda no relógio é a aplicação que está chegando.
      const adotado = !flags.condicao;
      // O efeito do HUD é só o ícone: para o prazo, ele conta como entrada.
      const chegando = turnos === SEM_PRAZO ? turnos : turnos + (adotado ? entrada : 0);
      const antes = adotado ? 1 : Number(flags.pilhas) || 0;
      const total = !contaPilhas ? 1
        : modoPilhas === "maior" ? Math.max(antes, soma)
        : antes + soma;
      /*
       * Aplicação que não muda o valor não mexe em nada: a Friagem 1 que chega
       * numa Friagem 2 não pode reiniciar o minuto que já estava correndo.
       */
      if (modoPilhas === "maior" && !adotado && total === antes) {
        return { pilhas: antes, turnos: flags.turnos ?? SEM_PRAZO, novo: false };
      }
      const prazo = adotado ? chegando : juntarPrazos(flags.turnos, turnos, modoPrazo);
      await existente.update({
        name: nomeDaCondicao(chave, total, contaPilhas),
        ...updateDePrazo(prazo ?? 0),
        [`flags.${SYSTEM_ID}.condicao`]: chave,
        [`flags.${SYSTEM_ID}.pilhas`]: total
      });
      return { pilhas: total, turnos: prazo, novo: false };
    }

    const novoPrazo = turnos === SEM_PRAZO ? turnos : turnos + entrada;
    await ActiveEffect.implementation.create(foundry.utils.mergeObject(
      dadosDePrazo(novoPrazo ?? 0, "turnos", {
        condicao: chave, pilhas: contaPilhas ? soma : 1
      }),
      {
        name: nomeDaCondicao(chave, soma, contaPilhas),
        img: PYRO.condicoes[chave]?.img ?? "icons/svg/aura.svg",
        origin: actor.uuid,
        statuses: [chave]
      }
    ), { parent: actor });
    return { pilhas: contaPilhas ? soma : 1, turnos: novoPrazo, novo: true };
  });
}

/**
 * Efeito que não é condição empilhável mas conta o mesmo relógio: a Defesa de
 * Pedra, por exemplo. Guarda o prazo na mesma flag para que tempo.mjs o
 * expire — a duração nativa do Foundry só marca o efeito como vencido, e as
 * mudanças continuariam somando na defesa depois da hora.
 *
 * @param {boolean} [proprio] verdadeiro quando o prazo corre nos turnos de
 *   quem carrega o efeito, e não em todo turno da cena.
 */
export function efeitoComPrazo(actor, dados, turnos, proprio = false) {
  return ActiveEffect.implementation.create(foundry.utils.mergeObject(
    dadosDePrazo(turnos, "turnos", { porTurnoProprio: proprio, rotulo: dados.name }),
    { ...dados, origin: dados.origin ?? actor.uuid }
  ), { parent: actor });
}

/** Tira pilhas; chegando a zero, o efeito some. */
export function reduzirCondicao(actor, chave, pilhas = Infinity) {
  return naFila(actor, async () => {
    const efeito = efeitoDaCondicao(actor, chave);
    if (!efeito) return 0;
    const atual = Math.max(0, Number(flagsDe(efeito)?.pilhas) || 0);
    const novo = Math.max(0, atual - Math.max(0, pilhas));
    if (novo === 0) {
      await efeito.delete();
      return 0;
    }
    await efeito.update({
      name: nomeDaCondicao(chave, novo),
      [`flags.${SYSTEM_ID}.pilhas`]: novo
    });
    return novo;
  });
}

/* -------------------------------------------------------------------------- */
/*  Regras das condições elementais                                           */
/* -------------------------------------------------------------------------- */

/** Prazo mínimo do Queimando (SRD Magia): duração menor que 2 vira 2. */
export const TURNOS_QUEIMANDO = 2;
/** Friagem dura um minuto, que na mesa são dez turnos. */
export const TURNOS_FRIAGEM = PYRO.turnosDeSegundos(60);
/** Sangramento também dura um minuto (SRD Técnicas: o traço diz isso). */
export const TURNOS_SANGRAMENTO = PYRO.turnosDeSegundos(60);

/**
 * Queimando: cada pilha queima 1d6 de calor por turno, e o prazo nunca fica
 * abaixo de dois turnos. Quem já ardia por 1 turno e leva 3 pilhas passa a
 * arder por 2 turnos com 5 pilhas.
 */
export function aplicarQueimando(actor, pilhas) {
  return empilharCondicao(actor, "queimando", pilhas, TURNOS_QUEIMANDO);
}

/**
 * Molhado: soma dados ao próximo dano de frio que chegar, e é consumido
 * inteiro nessa hora. Não tem prazo — a água espera.
 */
export function aplicarMolhado(actor, pilhas) {
  return empilharCondicao(actor, "molhado", pilhas, SEM_PRAZO);
}

/**
 * Sangramento: cada pilha tira 1 de PV por turno, direto, por um minuto. O
 * corte acumula — dois golpes que sangram somam as pilhas e o relógio volta
 * ao minuto cheio, como no Queimando.
 */
export function aplicarSangramento(actor, pilhas) {
  return empilharCondicao(actor, "sangramento", pilhas, TURNOS_SANGRAMENTO);
}

/** Friagem: cada reação custa pilhas² de estamina a mais, por um minuto. */
export function aplicarFriagem(actor, pilhas) {
  return empilharCondicao(actor, "friagem", pilhas, TURNOS_FRIAGEM, { pilhas: "maior" });
}

/** Estamina que a Friagem cobra de uma reação: pilhas ao quadrado. */
export function custoDeFriagem(actor) {
  const pilhas = pilhasDe(actor, "friagem");
  return pilhas * pilhas;
}

/**
 * Dados que o Molhado soma a uma instância de dano de frio. Vale o dado da
 * própria instância: um frio de 4d8 com Molhado 3 rola 3d8 a mais.
 */
export function dadosDeMolhado(actor, formula) {
  const pilhas = pilhasDe(actor, "molhado");
  if (!pilhas) return null;
  // Maior dado da fórmula: é o que representa o golpe, se ele misturar dados.
  const faces = [...String(formula ?? "").matchAll(/\d*d(\d+)/gi)]
    .map(m => Number(m[1]))
    .reduce((maior, f) => Math.max(maior, f), 0);
  return { pilhas, faces: faces || 6 };
}

/* -------------------------------------------------------------------------- */
/*  Condições mentais                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Uma condição mental por atributo (ver PYRO.condicoesMentais): cada uma dá
 * desvantagem nos testes do atributo dela e traz a proibição própria da
 * emoção.
 *
 * Mental não empilha: estar Irritado duas vezes é estar irritado. O que o
 * ponto gasto compra é tempo, então uma aplicação nova estende o prazo do que
 * já estava lá em vez de renomear o efeito para "Irritado 2".
 */
export function aplicarCondicaoMental(actor, chave, turnos) {
  if (!PYRO.condicoesMentais[chave]) return null;
  /*
   * Um turno a mais na primeira aplicação: a condição é posta no turno do
   * conjurador e o relógio já desconta um turno no fim dele, então "durar 1
   * turno" tem que alcançar o fim do turno seguinte. Quem já está sob a
   * condição só ganha os turnos comprados — o turno extra é o de entrada, e
   * quem decide se ela está entrando é a fila, não esta linha.
   */
  return empilharCondicao(actor, chave, 1, Math.max(1, turnos), {
    prazo: "soma", pilhas: "fixa", entrada: 1
  });
}

/** As sete condições mentais com o atributo de cada uma, para as interfaces. */
/** As condições mentais que o personagem sofre agora. */
export function mentaisAtivas(actor) {
  return Object.keys(PYRO.condicoesMentais).filter(chave => pilhasDe(actor, chave) > 0);
}

/**
 * Alguma condição mental ativa carrega esta marca? (ver PYRO.condicoesMentais)
 * Basta uma: as sete convivem, e a proibição de qualquer uma delas vale.
 */
export function regraMental(actor, marca) {
  return mentaisAtivas(actor).some(chave => PYRO.condicoesMentais[chave]?.[marca] === true);
}

/**
 * A desvantagem que as condições mentais impõem a um teste deste atributo.
 *
 * Uma por atributo, e uma só: a tabela é um-para-um, então não há como somar
 * duas desvantagens no mesmo teste. Teste sem atributo (as reações, que rolam
 * pool fixa) não passa por aqui — o insensato é barrado por outra marca.
 */
export function desvantagemMental(actor, atributo) {
  const chave = PYRO.mentalDoAtributo[atributo];
  return chave && pilhasDe(actor, chave) > 0 ? 1 : 0;
}

/**
 * Todas as condições mentais em curso, em uma linha — para o diálogo da
 * perícia, onde o atributo só é escolhido lá dentro e uma dica presa a um
 * atributo não teria como saber qual será.
 */
export function dicaMentais(actor) {
  const linhas = mentaisAtivas(actor).map(chave => game.i18n.format("PYRO.Mental.DicaTeste", {
    condicao: loc(PYRO.condicoes[chave]?.label ?? chave),
    atributo: loc(PYRO.atributos[PYRO.condicoesMentais[chave].atributo])
  }));
  return linhas.join(" ");
}

/** Linha do diálogo avisando de onde vem a desvantagem; vazia sem condição. */
export function dicaMental(actor, atributo) {
  const chave = PYRO.mentalDoAtributo[atributo];
  if (!chave || !pilhasDe(actor, chave)) return "";
  return game.i18n.format("PYRO.Mental.DicaTeste", {
    condicao: loc(PYRO.condicoes[chave]?.label ?? chave),
    atributo: loc(PYRO.atributos[atributo] ?? atributo)
  });
}

/**
 * Dados de rolagem de uma parcela de DANO, com o FOR zerado quando ele não
 * pode somar. O abatido não soma FOR ao dano
 * (SRD Condições): aqui o @for vale 0, e só aqui — o atributo continua inteiro
 * para o teste de acerto, para a carga e para tudo o mais.
 */
export function semForNoDano(actor, dados) {
  if (!regraMental(actor, "semForNoDano")) return dados;
  // A pool acompanha o atributo, como em getRollData: sem isso um "@dados.for"
  // escrito na fórmula continuaria rolando a Força cheia.
  const pools = dados?.dados ? { ...dados.dados, for: formulaPool(0) } : dados?.dados;
  return { ...dados, for: 0, ...(pools ? { dados: pools } : {}) };
}

/**
 * Ações que a confusão acrescenta: magia ou técnica de três ações ou mais
 * custa uma a mais. A conta é feita sobre o custo já ajustado pelos efeitos,
 * que é o que a mesa de fato paga.
 */
export function acoesComConfusao(actor, acoes) {
  const n = Math.max(0, Math.round(Number(acoes) || 0));
  return regraMental(actor, "acaoExtraAcima3") && n >= PYRO.ACOES_CONFUSO ? n + 1 : n;
}

/**
 * Recusa a ação que uma condição mental proíbe, avisando qual é. Devolve true
 * quando há proibição — quem chama sai sem fazer nada.
 */
export function barradoPorMental(actor, marca) {
  const chave = mentaisAtivas(actor).find(c => PYRO.condicoesMentais[c]?.[marca] === true);
  if (!chave) return false;
  ui.notifications.warn(game.i18n.format(`PYRO.Mental.${marca}`, {
    condicao: loc(PYRO.condicoes[chave]?.label ?? chave)
  }));
  return true;
}

export function listaDeCondicoesMentais() {
  return Object.entries(PYRO.condicoesMentais).map(([chave, cfg]) => ({
    chave,
    atributo: cfg.atributo,
    nome: loc(PYRO.condicoes[chave]?.label ?? chave),
    atributoNome: loc(PYRO.atributos[cfg.atributo] ?? cfg.atributo)
  }));
}

/* -------------------------------------------------------------------------- */
/*  O que a ficha mostra                                                       */
/* -------------------------------------------------------------------------- */

/**
 * As condições elementais que a aba de combate detalha, na ordem em que
 * aparecem. As mentais vêm depois delas, e não são todas as condições que
 * existem: aqui ficam só as que mudam uma conta que o jogador precisa fazer na
 * mesa — quanto custa reagir, quanto dano vem no próximo turno, quanto sobe a
 * defesa. Limiares de vida e marcadores soltos ficam na lista completa de
 * efeitos, na aba própria.
 */
const ELEMENTAIS_DETALHADAS = ["friagem", "queimando", "sangramento", "molhado"];

/** Uma linha da lista da ficha. */
function linha(chave, nome, valor, descricao, prazo) {
  return { chave, nome, valor, descricao, prazo };
}

function linhaDaCondicao(actor, chave) {
  const efeito = efeitoDaCondicao(actor, chave);
  if (!efeito) return null;
  const pilhas = pilhasDe(actor, chave);
  const descricao = chave === "friagem"
    ? loc("PYRO.Efeito.friagem", { custo: pilhas })
    : loc(`PYRO.Efeito.${chave}`, { n: pilhas });
  return linha(
    chave,
    loc(PYRO.condicoes[chave]?.label ?? chave),
    // Condição mental não tem pilha: o "(1)" ao lado do nome não diria nada.
    PYRO.condicoesMentais[chave] ? null : pilhas,
    descricao,
    rotuloDePrazo(efeito)
  );
}

/**
 * Efeitos com número que o personagem está sofrendo agora, prontos para a
 * ficha: nome, o quanto vale, o que ele faz e quanto tempo ainda dura.
 *
 * Junta três origens diferentes — condições empilháveis, a Defesa de Terra
 * (que é um efeito com prazo, e não uma condição) e a exaustão (que mora na
 * própria flag) — porque para quem lê a ficha as três são a mesma coisa: algo
 * pendurado no personagem que ele precisa lembrar na hora de rolar.
 */
export function efeitosDetalhados(actor) {
  const lista = [];

  for (const chave of ELEMENTAIS_DETALHADAS) {
    const l = linhaDaCondicao(actor, chave);
    if (l) lista.push(l);
  }

  for (const efeito of actor?.effects ?? []) {
    if (flagsDe(efeito)?.regra !== "defesaTerra") continue;
    lista.push(linha(
      "defesaTerra",
      loc("PYRO.Efeito.defesaTerraNome"),
      null,
      loc("PYRO.Efeito.defesaTerra", { n: Number(flagsDe(efeito).valor) || 0 }),
      rotuloDePrazo(efeito)
    ));
  }

  const exausto = nivelExaustao(actor);
  if (exausto > 0) {
    const desvantagens = Math.floor(exausto / 5);
    lista.push(linha(
      "exausto",
      loc("PYRO.Exaustao.Nome"),
      exausto,
      // A partir do quinto nível a exaustão também traz desvantagem, e a
      // linha precisa dizer as duas coisas.
      desvantagens > 0
        ? loc("PYRO.Efeito.exaustoDesvantagem", { n: exausto, d: desvantagens })
        : loc("PYRO.Efeito.exausto", { n: exausto }),
      ""
    ));
  }

  for (const chave of Object.keys(PYRO.condicoesMentais)) {
    const l = linhaDaCondicao(actor, chave);
    if (l) lista.push(l);
  }

  return lista;
}
