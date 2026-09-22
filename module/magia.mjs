/**
 * Regras de magia (SRD Magia): escalonamentos das runas, custo e sobrecarga
 * de uma frase rúnica e a conjuração em si, com o card de chat.
 */
import { PYRO } from "./config.mjs";
import { esc } from "./ui.mjs";
import { juntarDados, prepararFormula } from "./dados.mjs";
import {
  htmlEfeitosDeUso, htmlEfeitosDeRegra, bonusDeDano, multiplicadoresDeDano,
  aplicarMultDeDano, ajustesDeAtributo, ajustesDeCusto, custoAjustado
} from "./efeitos.mjs";
import { htmlBotaoSobrecarga } from "./teste.mjs";
import { flagsDoSistema } from "./sistema.mjs";
import { htmlClasseDaRolagem, flagsDaClasse } from "./progressao.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** Tipo de dano que desliga a rolagem: a runa só produz efeito e números. */
export const SEM_DANO = "nenhum";

/**
 * Ícone do botão de uma regra que não é condição, e por isso não tem imagem em
 * PYRO.condicoes. É o mesmo ícone do efeito que o clique cria.
 */
const IMG_DE_REGRA = {
  defesaTerra: "icons/svg/shield.svg",
  mental: "icons/svg/daze.svg"
};

/**
 * A @variável que cada regra publica. Só as que não se chamam igual: o nome da
 * regra da terra é "defesaTerra", mas a Intenção que a alimenta é a Defesa
 * Física, e é esse nome que um efeito escreveria.
 */
const CHAVE_DA_REGRA = {
  defesaTerra: "defesaFisica",
  mental: "condicoesMentais"
};

/* -------------------------------------------------------------------------- */
/*  Escalonamentos                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Valor de um escalonamento na Intenção N:
 *   floor(base + porIntencao x (N - 1))
 * O arredondamento é do total, não só do incremento: com base 0,5 e aumento
 * 0,5 a corrente do raio sai 0 na Intenção 1, 1 na 2, 1 na 3 e 2 na 4.
 */
export function valorScaling(scaling, intencao) {
  return Math.floor(scaling.base + scaling.porIntencao * (intencao - 1));
}

/**
 * O escalonamento depois do que o gesto Longo faz com ele (SRD Magia).
 *
 * Longo não soma metros: ele sobe o alcance na escada de passos, e o que
 * chega ao topo dessa escada é a base — um Projétil de 6 metros com Longo 1
 * passa a partir de 20. O ganho por Intenção vem junto e passa a ser metade
 * da base nova, senão a runa subiria de degrau e continuaria escalando no
 * ritmo do degrau antigo.
 *
 * Escalonamento que já não crescia com a Intenção continua sem crescer: o
 * alcance fixo da Explosão sobe de degrau, mas o Longo não inventa para ela
 * um ganho por Intenção que ela nunca teve.
 */
export function escalonamentoComPassos(scaling, passos = 0) {
  if (!passos || chaveVariavel(scaling.nome) !== "alcance") return scaling;
  const base = PYRO.subirAlcance(scaling.base, passos);
  return { ...scaling, base, porIntencao: scaling.porIntencao > 0 ? base / 2 : 0 };
}

/**
 * Valor de um escalonamento na conjuração: a Intenção efetiva da runa (já com
 * o que o Toque emprestou), os passos que o Longo somou ao alcance e o
 * multiplicador de efeito da língua.
 * @param {object} pr entrada de calc.porRuna.
 * @param {number} [passos] passos de alcance que o Longo somou à frase.
 */
export function valorEfetivo(pr, scaling, passos = 0) {
  const ajustado = escalonamentoComPassos(scaling, passos);
  const intencao = pr.intencaoEfetiva ?? pr.intencao;
  /*
   * O multiplicador da língua entra ANTES do arredondamento, que é um só e
   * do total: base 2,25 élfica (x2) na Intenção 2 é 4,5 x 2 = 9 — arredondar
   * o 4,5 primeiro comeria um dado.
   */
  const cru = ajustado.base + ajustado.porIntencao * (intencao - 1);
  return Math.floor(cru * (pr.efeitoMult ?? 1));
}

/**
 * Multiplicador do dano de um escalonamento com dados: a Intenção não soma
 * dados, ela multiplica o total rolado — 1 + porIntencao x (Intenção - 1).
 * A língua fica de fora de propósito: potencial mágico multiplica a
 * QUANTIDADE de dados (ver dadosDeDano) — o elfo rola 6d6 onde o humano rola
 * 3d6, que é mais forte e mais bonito de ver na mesa.
 */
export function fatorDeDano(pr, scaling) {
  const intencao = pr.intencaoEfetiva ?? pr.intencao;
  return 1 + (Number(scaling.porIntencao) || 0) * (intencao - 1);
}

/** Quantos dados o dano rola: a base vezes o potencial mágico da língua. */
export function dadosDeDano(pr, scaling) {
  return Math.max(1, Math.round((Number(scaling.base) || 0) * (pr.efeitoMult ?? 1)));
}

/** O fator como texto pt-BR para a mesa ler ("2", "1,75"). */
export const fatorPtBR = fator =>
  fator.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** Escalonamento de uma runa pela chave de variável ("passos", "alvos"). */
export function scalingPorChave(scalings, chave) {
  return (scalings ?? []).find(sc => chaveVariavel(sc.nome) === chave) ?? null;
}

/** A runa tem um escalonamento com esta chave de variável? */
export function temEscalonamento(item, chave) {
  return (item?.system?.scalings ?? []).some(sc => chaveVariavel(sc.nome) === chave);
}

/**
 * Chaves de escalonamento que o sistema lê como bônus fixo num teste, em vez
 * de número solto no card:
 *
 *   nd         soma na DT para resistir à magia.
 *   mira       soma no teste de mira, escrito de várias formas na mesa
 *              ("Bônus na Mira", "Bonus de mira", "Bônus Mira").
 *
 * Casar por nome de escalonamento, e não por nome de runa, é o que permite um
 * gesto novo entrar no compêndio já funcionando.
 */
export const CHAVE_ND = "nd";
const CHAVES_MIRA = /^bonus(Na|De|Da)?Mira$|^mira$/;

/** O escalonamento é um bônus de mira, em qualquer das grafias aceitas? */
export function ehBonusDeMira(nome) {
  return CHAVES_MIRA.test(chaveVariavel(nome));
}

/**
 * Bônus fixos que a frase soma aos testes: a DT da magia e o teste de mira.
 * Somam entre runas — dois gestos precisos somam os dois bônus.
 */
export function bonusDeTestes(porRuna, passos = 0) {
  let nd = 0;
  let mira = 0;
  for (const pr of porRuna) {
    for (const sc of pr.scalings ?? []) {
      const chave = chaveVariavel(sc.nome);
      if (chave === CHAVE_ND) nd += valorEfetivo(pr, sc, passos);
      else if (ehBonusDeMira(sc.nome)) mira += valorEfetivo(pr, sc, passos);
    }
  }
  return { nd, mira };
}

/* -------------------------------------------------------------------------- */
/*  Gestos com regra própria                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Os gestos que ainda dependem do nome da runa para serem reconhecidos.
 * Longo mexe na escada de alcance da frase e Dividir reparte o dano entre
 * alvos — nenhum dos dois cabe num escalonamento, que é sempre um número da
 * própria runa.
 */
export const GESTOS_COM_REGRA = ["longo", "dividir"];

/**
 * Que gesto conhecido esta runa é, pelo nome que a mesa deu a ela.
 *
 * O Toque saiu daqui: ele é reconhecido pelo escalonamento "Intenção extra"
 * (ver emprestaIntencao), porque o que ele faz é um número da própria runa.
 * Sobraram os dois gestos cuja regra é da frase inteira, não da runa.
 * @returns {string|null} chave do gesto (longo, dividir) ou null.
 */
export function regraDoGesto(item) {
  if (item.system.tipoRuna === "elemento") return null;
  const alvo = PYRO.normalizarTexto(item.system.palavra || item.name);
  const nomeados = PYRO.gestosNomeados();
  for (const chave of GESTOS_COM_REGRA) {
    const cfg = nomeados[chave];
    if (!cfg) continue;
    if (alvo === chave || alvo === PYRO.normalizarTexto(game.i18n.localize(cfg.label))) return chave;
  }
  return null;
}

/**
 * A runa empresta Intenção a outra da frase? É o que o Toque faz, e o que
 * qualquer gesto com um escalonamento "Intenção extra" passa a fazer — a
 * regra vive no número, então um gesto novo com esse escalonamento já
 * funciona sem o sistema conhecer o nome dele.
 */
export function emprestaIntencao(item) {
  return item?.system?.tipoRuna !== "elemento" && temEscalonamento(item, "intencaoExtra");
}

/**
 * O que uma runa produz por Intenção quando ela nasce ou troca de elemento.
 * Só o elemento tem tabela: os números dele são configuração do mundo. Gesto
 * nasce sem escalonamento — o jogador arrasta o gesto pronto do compêndio, ou
 * escreve os números que a mesa combinou.
 */
export function scalingsPadrao(tipoRuna, subtipo) {
  if (tipoRuna !== "elemento") return [];
  const cfg = PYRO.elementos[subtipo];
  if (!cfg) return [];
  return [
    ...(cfg.faces
      ? [{ nome: loc("PYRO.Scaling.Dano"), base: cfg.base, porIntencao: cfg.porIntencao, faces: cfg.faces }]
      : []),
    // Efeitos próprios do elemento que também escalam (corrente do raio).
    ...(cfg.extras ?? []).map(extra => ({ ...extra, nome: loc(extra.nome) }))
  ];
}

/* -------------------------------------------------------------------------- */
/*  Variáveis publicadas para os efeitos                                       */
/* -------------------------------------------------------------------------- */

/**
 * Chave de variável a partir do nome de um escalonamento:
 * "Alcance (m)" -> alcance, "PV do muro" -> pvDoMuro.
 * O trecho entre parênteses é unidade, não faz parte do nome.
 */
export function chaveVariavel(nome) {
  const limpo = String(nome ?? "")
    .replace(/\(.*?\)/g, " ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim();
  if (!limpo) return "";
  const [primeira, ...resto] = limpo.split(" ");
  return primeira.toLowerCase()
    + resto.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("");
}

/** Variáveis que toda conjuração publica, independente das runas usadas. */
export const VARIAVEIS_CONJURACAO = [
  "intencao", "intencaoMax", "mana", "acoes", "danoTotal", "cura"
];

/**
 * Chaves que este item vai publicar no card. O construtor de efeitos usa isso
 * para listar o que dá para referenciar sem o jogador ter que adivinhar.
 */
export function variaveisDoItem(item) {
  const chaves = new Set(VARIAVEIS_CONJURACAO);
  const juntar = lista => {
    for (const sc of lista ?? []) {
      const chave = chaveVariavel(sc.nome);
      if (chave) chaves.add(chave);
    }
  };

  if (item?.type === "runa") juntar(item.system.scalings);
  if (item?.type === "magia") {
    for (const ref of item.system.runas ?? []) juntar(ref.scalings);
  }
  return [...chaves];
}

/**
 * O que uma runa produz, em texto curto ("9d6 calor", "raio 2m"). Alimenta a
 * prévia do conjurador: o jogador vê o efeito antes de gastar mana, e não só
 * depois no card do chat. É a mesma conta da conjuração, sobre os mesmos
 * escalonamentos.
 * @param {object} pr entrada de calc.porRuna.
 * @param {number} [passos] passos de alcance que o gesto Longo somou à frase.
 */
export function previaRuna(pr, passos = 0) {
  const sys = pr.item.system;
  const cfg = sys.tipoRuna === "elemento" ? PYRO.elementos[sys.subtipo] : null;
  const tipoChave = pr.tipoDano || cfg?.tipoDano || "";
  const semDano = tipoChave === SEM_DANO;
  const tipo = tipoChave && !semDano
    ? loc(PYRO.tiposDano[tipoChave]?.label ?? `PYRO.Dano.${tipoChave}`) : "";
  // Runa sem dano não rola nada: só os escalonamentos numéricos aparecem.
  const texto = (pr.scalings ?? []).map(sc => {
    if (sc.faces > 0 && semDano) return null;
    // Os passos do Longo entram dentro da conta, na base e no ganho por
    // Intenção, e não sobre o total já somado.
    if (sc.faces > 0) {
      const dados = dadosDeDano(pr, sc);
      const fator = fatorDeDano(pr, sc);
      const mult = fator === 1 ? "" : ` x${fatorPtBR(fator)}`;
      return `${dados}d${sc.faces}${mult}${tipo ? ` ${tipo}` : ""}`;
    }
    const valor = valorEfetivo(pr, sc, passos);
    const nome = sc.nome?.trim();
    return nome ? `${nome} ${valor}` : String(valor);
  }).filter(Boolean).join(" · ");
  return texto || (semDano ? loc("PYRO.Dano.nenhum") : "");
}

/**
 * O que a frase inteira produz, já juntado: dados de mesmo tipo numa fórmula
 * só, escalonamentos de mesmo nome numa linha só.
 *
 * É o que o card do chat publica e o que a prévia do Conjurador mostra — a
 * mesma conta, feita uma vez. Dois gestos que aumentam a Duração aparecem
 * somados nos dois lugares, e uma runa que teima em sair sozinha na prévia
 * também sai sozinha no card, que é onde o erro fica visível.
 *
 * @param {object} calc saída de calcular().
 * @param {object[]} [bonusDano] bônus de dano de efeitos, que entram nos grupos.
 * @returns {{danos: object[], numeros: object[], subjulgares: object[],
 *            efeitos: string[], publicados: object[], regras: object[]}}
 */
export function resumoDaFrase(calc, { bonusDano = [] } = {}) {
  const gruposDeDano = new Map();
  const numeros = new Map();
  const efeitos = [];
  const subjulgares = [];
  const publicados = [];
  const regras = [];

  /*
   * O grupo junta parcelas do mesmo tipo E mesmo multiplicador: a rolagem é
   * uma só por grupo, e um fator diferente não teria como multiplicar só a
   * parte dele de um total já somado. Bônus de efeito entram com fator 1.
   */
  const somarDano = (tipo, parte, origem, nomeScaling = null, fator = 1) => {
    const chave = `${tipo}|${fator}`;
    const grupo = gruposDeDano.get(chave)
      ?? { tipo, fator, partes: [], origens: new Set(), scalings: new Set() };
    grupo.partes.push(parte);
    grupo.origens.add(origem);
    if (nomeScaling) grupo.scalings.add(nomeScaling);
    gruposDeDano.set(chave, grupo);
  };

  const somarNumero = (nome, valor, origem) => {
    const grupo = numeros.get(nome) ?? { valor: 0, origens: new Set() };
    grupo.valor += valor;
    grupo.origens.add(origem);
    numeros.set(nome, grupo);
  };

  for (const pr of calc.porRuna) {
    const sys = pr.item.system;
    const nomeRuna = sys.palavra || pr.item.name;
    // Tipo "Não causa dano": os dados não são rolados, o resto continua.
    const semDano = pr.tipoDano === SEM_DANO;
    /*
     * Só elemento herda tipo de dano da tabela: gesto guarda um subtipo que
     * não quer dizer nada aqui, e um Toque com dados sairia como dano de
     * energia.
     */
    const elCfg = sys.tipoRuna === "elemento" ? PYRO.elementos[sys.subtipo] : null;
    const tipoDano = pr.tipoDano || elCfg?.tipoDano || "";

    for (const sc of pr.scalings) {
      if (sc.faces > 0) {
        if (semDano) continue;
        /*
         * Dano não escala em dados: a base é fixa e a Intenção (com a
         * língua) multiplica o TOTAL. O floor mora na própria fórmula,
         * então o total da rolagem já sai certo para tudo que o lê — os
         * botões de aplicar, as @variáveis, os 6 do fogo.
         */
        const dados = dadosDeDano(pr, sc);
        const fator = fatorDeDano(pr, sc);
        // A fórmula fica só com os dados (já com o potencial da língua); o
        // fator da Intenção viaja ao lado e multiplica o total na hora de
        // rolar — o card mostra "6d6" e a linha do multiplicador embaixo.
        const formula = `${dados}d${sc.faces}`;
        // Subjulgar não causa dano direto: cada rolagem é comparada com a
        // vida do alvo por si, então fica fora do agrupamento.
        if (pr.subjulgar) subjulgares.push({ nomeRuna, formula, fator });
        else somarDano(tipoDano, formula, nomeRuna, sc.nome, fator);
        continue;
      }
      const valor = valorEfetivo(pr, sc, calc.passosAlcance);
      /*
       * Três Intenções não viram número solto no card, porque já apareceram
       * em outro lugar: ND e bônus de mira entraram nos testes, e a que
       * alimenta um botão de regra (o Molhado da água, a Friagem do gelo) já
       * está escrita no próprio botão. Todas continuam publicadas como
       * @variável para os efeitos.
       */
      const chave = chaveVariavel(sc.nome);
      // Intenção que alimenta um botão de regra já está escrita no botão —
      // mas só quando ela rendeu alguma coisa: valendo 0 não há botão, e
      // esconder o número deixaria a Intenção invisível no card.
      const daRegra = !!PYRO.regrasDeIntencao[chave] && valor > 0;
      if (chave === CHAVE_ND || ehBonusDeMira(sc.nome) || daRegra) {
        publicados.push({ nome: sc.nome, valor });
        // A regra vira botão no card e linha na prévia: sem isso o Molhado da
        // água só apareceria depois da mana gasta.
        if (daRegra) regras.push({ nome: sc.nome, valor, origem: nomeRuna });
        continue;
      }
      somarNumero(sc.nome || loc("PYRO.Scaling.Efeito"), valor, nomeRuna);
    }

    if (elCfg?.efeito) efeitos.push(loc(elCfg.efeito));
  }

  /*
   * Bônus de dano de efeitos ("Foco em Fogo: 2d6") entram no grupo do tipo
   * deles, e não como uma rolagem à parte: quem recebe o dano soma uma vez só.
   */
  for (const bonus of bonusDano) {
    somarDano(bonus.tipo || [...gruposDeDano.keys()][0] || "", bonus.formula, bonus.nome);
  }

  /*
   * Os passos do Longo já entraram na conta de cada runa, na base e no ganho
   * por Intenção — o que sai daqui é o valor final, e só a nota lembra que o
   * alcance subiu de degrau.
   */
  const subiuDegrau = calc.passosAlcance > 0;

  return {
    danos: [...gruposDeDano.values()].map(grupo => ({
      tipo: grupo.tipo,
      fator: grupo.fator,
      rotulo: grupo.tipo
        ? loc(PYRO.tiposDano[grupo.tipo]?.label ?? `PYRO.Dano.${grupo.tipo}`)
        : loc("PYRO.Item.Dano"),
      origens: [...grupo.origens],
      scalings: [...grupo.scalings],
      formula: juntarDados(grupo.partes)
    })),
    numeros: [...numeros].map(([nome, grupo]) => ({
      nome,
      valor: grupo.valor,
      origens: [...grupo.origens],
      porPassos: subiuDegrau && chaveVariavel(nome) === "alcance" ? calc.passosAlcance : 0
    })),
    subjulgares,
    efeitos,
    publicados,
    regras
  };
}

/**
 * Tabela de Subjulgar: para cada DET de alvo, o multiplicador, o resultado já
 * multiplicado e até quanto de PV máximo o alvo pode ter para sofrer cada
 * patamar (25%, 50% e 100% da vida máxima dele).
 */
export function tabelaSubjulgar(det, total) {
  const linhas = [];
  for (const faixa of PYRO.faixasSubjulgar) {
    const alvo = det - faixa.dif;
    // DET mínimo é 1: faixas impossíveis não entram.
    if (!faixa.faixa && alvo < 1) continue;
    if (faixa.faixa === "abaixo" && alvo < 1) continue;

    const mult = faixa.mult ?? PYRO.multiplicadorSubjulgar(faixa.dif);
    const valor = Math.floor(total * mult);
    const rotuloAlvo = faixa.faixa === "acima" ? `≥ ${Math.max(1, alvo)}`
      : faixa.faixa === "abaixo" ? `≤ ${alvo}`
      : `${alvo}`;

    linhas.push({
      alvo: rotuloAlvo,
      mult,
      valor,
      // Efeito dispara quando o valor alcança X% da vida máxima do alvo,
      // ou seja, quando a vida máxima dele é no máximo valor / X%.
      apavorado: valor > 0 ? valor * 4 : 0,
      desmaiado: valor > 0 ? valor * 2 : 0,
      subjugado: valor
    });
  }

  // Linha compacta: a barra de chat é estreita demais para uma tabela de 6 colunas.
  const corpo = linhas.map(l => l.mult === 0
    ? `<li class="sub-nulo">${loc("PYRO.Subjulgar.DetAlvo")} ${l.alvo} — ${loc("PYRO.Subjulgar.SemEfeito")}</li>`
    : `<li>
        <div class="sub-topo">
          <span class="sub-det">${loc("PYRO.Subjulgar.DetAlvo")} ${l.alvo}</span>
          <span class="sub-mult">${l.mult}x</span>
          <strong class="sub-valor">${l.valor}</strong>
        </div>
        <div class="sub-limiares">
          ${loc("PYRO.Subjulgar.Apavora")} ${l.apavorado}
          · ${loc("PYRO.Subjulgar.Desmaia")} ${l.desmaiado}
          · ${loc("PYRO.Subjulgar.Subjuga")} ${l.subjugado}
        </div>
      </li>`
  ).join("");

  return `<div class="pyro-subjulgar">
    <p class="pyro-subjulgar-titulo">${loc("PYRO.Subjulgar.Titulo", { det, total })}</p>
    <ul class="sub-linhas">${corpo}</ul>
    <p class="sub-legenda">${loc("PYRO.Subjulgar.Legenda")}</p>
  </div>`;
}

/* -------------------------------------------------------------------------- */
/*  Cálculo (compartilhado entre o preview do Conjurador e a conjuração)       */
/* -------------------------------------------------------------------------- */

/**
 * @param {Actor} actor
 * @param {Array<{item: Item, intencao: number, scalings?: object[]}>} escolhas
 * @param {Item} [itemMagia] magia do grimório, quando a frase veio de uma.
 *   Serve para os efeitos de custo presos a ela entrarem na conta — e como o
 *   conjurador e a conjuração chamam a mesma função, a prévia nunca mostra um
 *   custo diferente do que vai ser cobrado.
 */
export function calcular(actor, escolhas, itemMagia = null) {
  const fatorRaca = actor.system.fatorLinguistico ?? 1;
  const limiteBase = actor.system.sobrecargaLimite;

  let custoTotal = 0;
  let sobrecarga = 0;
  let somaIntencoes = 0;
  let maosUsadas = 0;
  const porRuna = [];

  for (const { item, intencao, scalings, subjulgar, tipoDano, alvoToque } of escolhas) {
    const sys = item.system;
    const lingua = PYRO.linguas[sys.lingua];
    const custoBase = PYRO.custoIntencao(intencao);
    // Custo relativo: fator da língua / fator da raça, arredondado pra baixo, mínimo 1.
    const custo = Math.max(1, Math.floor(custoBase * lingua.fator / fatorRaca));
    // Limite seguro por runa: escala quando a raça supera a língua.
    const limite = Math.floor(limiteBase * Math.max(1, fatorRaca / lingua.fator));
    const excesso = Math.max(0, intencao - limite);

    custoTotal += custo;
    sobrecarga += excesso;
    somaIntencoes += intencao;
    // Gestos (formas e modificadores) ocupam mãos; elementos são verbais.
    if (sys.tipoRuna !== "elemento") maosUsadas += sys.maos ?? 1;
    porRuna.push({
      item, intencao, custo, limite, excesso, alvoToque,
      // O Toque empresta Intenção para os escalonamentos, mas não para o
      // custo: quem paga é a Intenção declarada em cada runa.
      intencaoEfetiva: intencao,
      // Frase montada na hora usa o que a runa define; magia salva traz a
      // própria cópia (escalonamentos, Subjulgar e tipo de dano) por cima.
      scalings: scalings ?? sys.scalings ?? [],
      subjulgar: subjulgar ?? sys.subjulgar ?? false,
      tipoDano: tipoDano ?? sys.tipoDano ?? "",
      efeitoMult: lingua.efeito
    });
  }

  /* --- Gestos com comportamento próprio (SRD Magia) ---------------------- */
  const doGesto = chave => porRuna.filter(pr => regraDoGesto(pr.item) === chave);
  const numeroDoGesto = (pr, chave) => {
    const sc = scalingPorChave(pr.scalings, chave);
    return sc ? valorEfetivo(pr, sc) : pr.intencao;
  };

  /*
   * Toque: cada Intenção nele dá +1 de Intenção a uma runa escolhida na frase.
   * Quem é Toque se sabe pelo escalonamento "Intenção extra", não pelo nome.
   */
  for (const toque of porRuna.filter(pr => emprestaIntencao(pr.item))) {
    const extra = numeroDoGesto(toque, "intencaoExtra");
    const alvo = porRuna.find(pr => pr.item.id === toque.alvoToque && pr !== toque)
      ?? porRuna.find(pr => pr.item.system.tipoRuna === "elemento");
    if (alvo && extra > 0) alvo.intencaoEfetiva += extra;
  }

  // Longo: sobe o alcance da frase na escada dos passos.
  const passosAlcance = doGesto("longo")
    .reduce((total, pr) => total + numeroDoGesto(pr, "passos"), 0);
  // Dividir: o dano é repartido entre os alvos.
  const alvosDivididos = doGesto("dividir")
    .reduce((maior, pr) => Math.max(maior, numeroDoGesto(pr, "alvos")), 0);

  // Escalonamentos que não são número solto no card, e sim bônus num teste.
  const bonus = bonusDeTestes(porRuna, passosAlcance);

  // Efeitos de custo entram por último, sobre o total. As reduções acumulam,
  // mas com piso 1: desconto nenhum deixa a magia de graça.
  const ajustes = ajustesDeCusto(actor, itemMagia);

  return {
    porRuna,
    custoTotal: custoAjustado(custoTotal, ajustes.mana),
    custoBase: custoTotal,
    sobrecarga,
    somaIntencoes,
    maos: maosUsadas,
    passosAlcance,
    alvosDivididos,
    bonusMira: bonus.mira,
    // 1 ação por runa verbal ou somática (SRD §5), antes dos efeitos.
    acoes: custoAjustado(escolhas.length, ajustes.acoes),
    nd: 10 + somaIntencoes,
    // DT para resistir à magia: a SAB de quem conjura (SRD Magia), mais o que
    // as runas de precisão somarem.
    dt: actor.system.atributos.sab.total + bonus.nd,
    temElemento: escolhas.some(e => e.item.system.tipoRuna === "elemento"),
    temForma: escolhas.some(e => e.item.system.tipoRuna === "forma")
  };
}

/* -------------------------------------------------------------------------- */
/*  Conjuração                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A frase causa dano mental? É o que decide se a conjuração precisa escolher
 * qual recurso do alvo o dano drena (SRD §6).
 */
export function temDanoMental(porRuna) {
  return porRuna.some(pr => {
    const sys = pr.item.system;
    const cfg = sys.tipoRuna === "elemento" ? PYRO.elementos[sys.subtipo] : null;
    return (pr.tipoDano || cfg?.tipoDano) === "mental";
  });
}

/** Quantos 6 saíram na rolagem: é por 6 que o fogo aumenta o Queimando. */
function contarSeis(roll) {
  let total = 0;
  for (const dado of roll.dice) {
    for (const resultado of dado.results) {
      if (resultado.active !== false && resultado.result === 6) total++;
    }
  }
  return total;
}

/**
 * Conjura a frase: valida, gasta mana, testa sobrecarga, rola os dados e
 * publica o card no chat.
 * @param {object} [opcoes.itemMagia] magia do grimório de origem, quando houver.
 */
export async function conjurar(actor, escolhas, {
  nomeMagia = null, rolarDano = true, itemMagia = null, recursoMental = "mana", usaDt = true
} = {}) {
  if (!escolhas.length) return;

  const calc = calcular(actor, escolhas, itemMagia);
  const recursos = actor.system.recursos;

  // Toda magia precisa de ao menos um Elemento e uma Forma (SRD Magia).
  if (!calc.temElemento || !calc.temForma) {
    return ui.notifications.warn(loc("PYRO.Avisos.ElementoEForma"));
  }
  if (calc.custoTotal > recursos.mana.value) {
    return ui.notifications.warn(loc("PYRO.Avisos.SemMana", { custo: calc.custoTotal, mana: recursos.mana.value }));
  }
  const maosDisponiveis = actor.system.maos ?? 2;
  if (calc.maos > maosDisponiveis) {
    return ui.notifications.warn(loc("PYRO.Avisos.SemMaos", { usadas: calc.maos, maos: maosDisponiveis }));
  }

  /* --- Teste de sobrecarga: SAB contra 10 + soma das Intenções ------------ */
  /* A exaustão que o personagem já carrega desconta do próprio teste. */
  /*
   * Sem teste de sobrecarga a conjuração é rotineira por regra (SRD Magia).
   * Com ele, quem mede a dificuldade é o próprio teste — e ele agora sai do
   * botão do card, não sozinho: a classe e o "contar uso" vão junto para lá.
   */
  const classe = calc.sobrecarga > 0 ? null : "rotineira";

  /* --- Gasto de mana (a magia sai de qualquer jeito) ---------------------- */
  await actor.update({ "system.recursos.mana.value": recursos.mana.value - calc.custoTotal });

  /* --- Montagem do card e rolagens ---------------------------------------- */
  const rolls = [];
  const partes = [];
  // Totais separados: o menu do chat aplica dano ou cura sem somar o teste.
  const danos = [];
  let totalCura = 0;

  /*
   * Variáveis desta conjuração, publicadas nas flags do card. Um efeito de uso
   * pode escrever "@alcance" ou "@intencao" no valor, e o número certo entra
   * quando alguém clica em aplicar — a mesma magia rende efeitos diferentes
   * conforme a Intenção escolhida na hora.
   */
  const variaveis = {
    intencao: calc.somaIntencoes,
    intencaoMax: calc.porRuna.reduce((m, pr) => Math.max(m, pr.intencao), 0),
    mana: calc.custoTotal,
    acoes: calc.acoes,
    danoTotal: 0,
    cura: 0
  };
  // Duas runas com o mesmo escalonamento (dois alcances): vale o maior.
  const publicar = (nome, valor) => {
    const chave = chaveVariavel(nome);
    if (!chave || !Number.isFinite(valor)) return;
    variaveis[chave] = Math.max(variaveis[chave] ?? Number.NEGATIVE_INFINITY, valor);
  };

  const titulo = nomeMagia
    ? esc(nomeMagia)
    : escolhas.map(e => esc(e.item.system.palavra || e.item.name)).join(" ");
  partes.push(`<header class="pyro-magia-titulo">
    <h3>${titulo}</h3>
    <span class="pyro-magia-meta">${loc("PYRO.Chat.CustoMagia", { mana: calc.custoTotal, acoes: calc.acoes })}</span>
  </header>`);

  const nativa = actor.system.linguaNativa;
  const linhas = calc.porRuna.map(pr => {
    const sys = pr.item.system;
    const tipo = loc(PYRO.tiposRuna[sys.tipoRuna]);
    const lingua = sys.lingua !== nativa ? ` · ${loc(PYRO.linguas[sys.lingua].label)}` : "";
    return `<li><strong>${esc(sys.palavra || pr.item.name)}</strong>
      <span class="pyro-runa-meta">${tipo}${lingua} · ${loc("PYRO.Magia.Intencao")} ${pr.intencao}
      · ${pr.custo} ${loc("PYRO.Recursos.mana")}</span></li>`;
  }).join("");
  partes.push(`<ul class="pyro-runas-usadas">${linhas}</ul>`);

  /*
   * DT para resistir: a SAB de quem conjura (SRD Magia), mais os bônus de
   * precisão. Nem toda magia impõe resistência — um muro de pedra não pede
   * teste de ninguém —, então a linha só sai quando esta conjuração usa DT.
   * Magia mental é resistida com um teste de SAB do alvo, no lugar da esquiva.
   */
  if (usaDt) {
    const ehMental = temDanoMental(calc.porRuna);
    partes.push(`<p class="pyro-dt">${loc("PYRO.Magia.DT", { valor: calc.dt })}${
      ehMental ? ` ${loc("PYRO.Magia.DTMental")}` : ""}</p>`);
  }

  // Bônus de mira que as runas somam: o teste é feito à parte, então o card
  // publica o número para quem for rolar.
  if (calc.bonusMira) {
    partes.push(`<p class="pyro-nota">${loc("PYRO.Magia.BonusMira", { valor: calc.bonusMira })}</p>`);
  }

  // Teste de sobrecarga: falhar custa exaustão, nunca a magia. O dado é
  // rolado pelo botão, quando o conjurador estiver pronto para encará-lo.
  if (calc.sobrecarga > 0) {
    partes.push(htmlBotaoSobrecarga({
      atorUuid: actor.uuid,
      itemUuid: itemMagia?.uuid ?? "",
      atributo: "sab",
      nd: calc.nd,
      exaustao: calc.sobrecarga,
      // "+2 SAB nesta magia" vale no teste que ela obriga.
      bonusAtributo: ajustesDeAtributo(actor, itemMagia).sab ?? 0,
      motivo: loc("PYRO.Sobrecarga.Pendente", { nivel: calc.sobrecarga, nd: calc.nd })
    }));
  }

  /* --- Números e dados da frase, já juntados ------------------------------ */
  const resumo = resumoDaFrase(calc, { bonusDano: rolarDano ? bonusDeDano(actor, itemMagia) : [] });

  /* --- Números, um por escalonamento --------------------------------------- */
  for (const { nome, valor } of resumo.publicados) publicar(nome, valor);
  for (const numero of resumo.numeros) {
    publicar(numero.nome, numero.valor);
    const nota = numero.porPassos
      ? ` <em>${loc("PYRO.Magia.PorPassos", { passos: numero.porPassos })}</em>` : "";
    const origens = numero.origens.map(esc).join(", ");
    partes.push(`<p class="pyro-forma"><strong>${esc(numero.nome)}</strong> — ${origens}: ${numero.valor}${nota}</p>`);
  }

  /* --- Dano, um bloco por tipo -------------------------------------------- */
  let seis = 0;
  // Os 6 contam por tipo de dano: o Queimando do fogo nasce dos dados de calor,
  // e não de um 6 rolado no gelo que veio junto na mesma frase.
  const seisPorTipo = new Map();
  for (const { tipo, fator, rotulo, formula, scalings, origens: nomes } of resumo.danos) {
    const origens = nomes.map(esc).join(", ");
    const multTexto = fator !== 1
      ? loc("PYRO.Magia.MultDanoLinha", { fator: fatorPtBR(fator) }) : "";
    if (!rolarDano) {
      partes.push(`<p class="pyro-forma"><strong>${rotulo}</strong> — ${origens}: ${formula}${multTexto ? ` · ${multTexto}` : ""} (${loc("PYRO.Chat.NaoRolado")})</p>`);
      continue;
    }
    // Os dados da magia salva, quando a conjuração veio de uma: é dela que
    // [NVL] tira o nível. Frase montada na hora não tem nível nenhum.
    const dados = (itemMagia ?? actor).getRollData();
    const roll = await new Roll(prepararFormula(formula, dados), dados).evaluate();
    rolls.push(roll);
    // A Intenção (com a língua) multiplica o total rolado; o card mostra a
    // rolagem crua e a linha do multiplicador embaixo explica o número final.
    const total = fator === 1 ? roll.total : Math.floor(roll.total * fator);
    if (tipo === "cura") totalCura += total;
    else {
      // A fórmula acompanha o total: é dela que o Molhado tira o dado a somar.
      danos.push({ tipo, total, formula });
      const doGrupo = contarSeis(roll);
      seis += doGrupo;
      seisPorTipo.set(tipo, (seisPorTipo.get(tipo) ?? 0) + doGrupo);
    }
    // O total do grupo vale para cada escalonamento que entrou nele: um efeito
    // que escreve "@dano" recebe o dano daquele tipo, já somado.
    for (const nomeSc of scalings) publicar(nomeSc, total);
    partes.push(`<div class="pyro-dano dano-${tipo || "simples"}">
      <p><strong>${rotulo}</strong> — ${origens}: ${formula}</p>
      ${await roll.render()}
      ${fator !== 1 ? `<p class="pyro-nota">${loc("PYRO.Magia.MultDano", {
        fator: fatorPtBR(fator), antes: roll.total, depois: total
      })}</p>` : ""}
    </div>`);
  }

  // Multiplicadores de dano dos efeitos, sobre o total já rolado — antes do
  // danoTotal, que alimenta o Dividir e as @variáveis.
  for (const nota of aplicarMultDeDano(danos, multiplicadoresDeDano(actor, itemMagia))) {
    partes.push(`<p class="pyro-nota">${nota}</p>`);
  }

  variaveis.danoTotal = danos.reduce((total, d) => total + d.total, 0);
  variaveis.cura = totalCura;
  // "Para cada 6 rolado" é regra do fogo: só conta os dados de dano, e só faz
  // sentido quando a magia causou algum.
  if (danos.length) variaveis.seis = seis;

  // Dividir reparte o dano entre os alvos (SRD Magia, gestos modificadores).
  if (calc.alvosDivididos > 1 && variaveis.danoTotal) {
    partes.push(`<p class="pyro-dividido">${loc("PYRO.Magia.Dividido", {
      alvos: calc.alvosDivididos,
      valor: Math.floor(variaveis.danoTotal / calc.alvosDivididos)
    })}</p>`);
  }

  /* --- Subjulgar: a rolagem é comparada com a vida do alvo ---------------- */
  for (const sub of resumo.subjulgares) {
    if (!rolarDano) {
      partes.push(`<p class="pyro-forma"><strong>${esc(sub.nomeRuna)}:</strong> ${sub.formula} (${loc("PYRO.Chat.NaoRolado")})</p>`);
      continue;
    }
    const roll = await new Roll(sub.formula).evaluate();
    rolls.push(roll);
    const fator = sub.fator ?? 1;
    const total = fator === 1 ? roll.total : Math.floor(roll.total * fator);
    partes.push(`<div class="pyro-dano">
      <p><strong>${esc(sub.nomeRuna)}</strong>: ${sub.formula}</p>
      ${await roll.render()}
      ${fator !== 1 ? `<p class="pyro-nota">${loc("PYRO.Magia.MultDano", {
        fator: fatorPtBR(fator), antes: roll.total, depois: total
      })}</p>` : ""}
    </div>`);
    partes.push(tabelaSubjulgar(actor.system.det, total));
  }

  // Efeito de referência de cada elemento, depois dos números que ele rendeu.
  for (const texto of resumo.efeitos) partes.push(`<p class="pyro-efeito">${texto}</p>`);

  /* --- Efeitos que o card aplica em um clique ----------------------------- */
  /*
   * O número de cada efeito sai do escalonamento da própria runa, e não de
   * uma conta escondida aqui: a Água diz quanto Molhado dá, o Gelo quanta
   * Friagem, e o mestre ajusta isso na runa como ajusta o dano. O Fogo é a
   * exceção que a regra pede — o Queimando dele vem dos 6 rolados no dano.
   */
  /*
   * Um botão por regra, e não por runa: duas Águas na mesma frase molham o
   * alvo uma vez só, com a soma das duas — do mesmo jeito que dois
   * escalonamentos de mesmo nome viram uma linha só de número.
   */
  const porRegra = new Map();
  const somarRegra = (cfg, valor, sys) => {
    if (valor <= 0) return;
    const atual = porRegra.get(cfg.regra);
    if (atual) {
      atual.valor += valor;
      return;
    }
    porRegra.set(cfg.regra, {
      regra: cfg.regra,
      valor,
      noConjurador: !!cfg.noConjurador,
      img: PYRO.condicoes[cfg.regra]?.img
        ?? PYRO.elementos[sys.subtipo]?.img ?? IMG_DE_REGRA[cfg.regra] ?? "icons/svg/aura.svg"
    });
  };

  // Os 6 já vêm somados por tipo de dano: contar o mesmo tipo uma vez por runa
  // faria duas runas de Fogo darem o dobro do Queimando que a frase rendeu.
  /*
   * Queimando é a exceção: ele conta os 6 do dano, não uma Intenção — e cada
   * 6 vale a Intenção da runa em pilhas, para a queimadura andar no passo do
   * dano novo, que multiplica o total em vez de somar dados: Intenção 3 com
   * três 6 é Queimando 9. Com duas runas do mesmo tipo os 6 são contados uma
   * vez só, e vale a maior Intenção entre elas.
   */
  const regraDosSeis = new Map();
  for (const pr of calc.porRuna) {
    const sys = pr.item.system;
    // Uma Intenção com nome de regra vale a regra, venha ela da runa que vier.
    for (const sc of pr.scalings ?? []) {
      const cfg = PYRO.regrasDeIntencao[chaveVariavel(sc.nome)];
      if (cfg) somarRegra(cfg, valorEfetivo(pr, sc, calc.passosAlcance), sys);
    }
    const seisCfg = sys.tipoRuna === "elemento" ? PYRO.regraDosSeis[sys.subtipo] : null;
    if (!seisCfg) continue;
    const tipo = pr.tipoDano || PYRO.elementos[sys.subtipo]?.tipoDano;
    const intencao = pr.intencaoEfetiva ?? pr.intencao;
    const atual = regraDosSeis.get(tipo);
    if (!atual || intencao > atual.intencao) regraDosSeis.set(tipo, { seisCfg, sys, intencao });
  }
  for (const [tipo, { seisCfg, sys, intencao }] of regraDosSeis) {
    // Botão de zero só engana: fogo sem nenhum 6 não rendeu Queimando.
    somarRegra(seisCfg, (seisPorTipo.get(tipo) ?? 0) * Math.max(1, intencao), sys);
  }

  const efeitosRegra = [...porRegra.values()].map(e => ({
    ...e,
    dt: calc.dt,
    name: loc(`PYRO.Regra.${e.regra}`, { valor: e.valor })
  }));
  // A @variável da Intenção acompanha o botão: um efeito que escreva "@molhado"
  // recebe o mesmo número que o alvo vai levar.
  for (const e of efeitosRegra) publicar(CHAVE_DA_REGRA[e.regra] ?? e.regra, e.valor);

  if (efeitosRegra.length) partes.push(htmlEfeitosDeRegra(efeitosRegra));

  // Botões dos efeitos de uso: os da magia salva e os das runas da frase.
  partes.push(htmlEfeitosDeUso(itemMagia, calc.porRuna.map(pr => pr.item)));
  /*
   * Só magia salva progride: frase montada na hora não tem onde contar o uso.
   * Com sobrecarga a classe é null aqui — quem mede a dificuldade é o teste,
   * e é no card dele que o botão de contar aparece.
   */
  partes.push(htmlClasseDaRolagem(classe, itemMagia));

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="pyro-chat">${partes.join("")}</div>`,
    rolls,
    flags: flagsDoSistema({
      danos, cura: totalCura, variaveis, efeitosRegra,
      // Qual recurso o dano mental drena é escolha da conjuração (SRD §6).
      recursoMental,
      ...flagsDaClasse(classe, itemMagia)
    }),
    sound: CONFIG.sounds.dice
  });
}

/* -------------------------------------------------------------------------- */
/*  Conjurar uma magia salva no grimório                                       */
/* -------------------------------------------------------------------------- */

/**
 * Magias salvas guardam só o conjunto de palavras. As Intenções são escolhidas
 * de novo a cada conjuração, no mesmo conjurador usado para montar frases —
 * assim o gasto de mana e a sobrecarga aparecem antes de confirmar.
 */
export async function conjurarMagiaSalva(actor, magia) {
  const frase = [];
  const faltando = [];

  for (const ref of magia.system.runas) {
    const item = actor.items.get(ref.itemId);
    if (!item) {
      faltando.push(ref.nome);
      continue;
    }
    frase.push({
      id: item.id, intencao: 1, original: true,
      scalings: foundry.utils.deepClone(ref.scalings ?? []),
      subjulgar: !!ref.subjulgar,
      tipoDano: ref.tipoDano ?? ""
    });
  }

  if (faltando.length) {
    return ui.notifications.warn(loc("PYRO.Avisos.RunasFaltando", { runas: faltando.join(", ") }));
  }
  if (!frase.length) return;

  // Importa aqui para evitar dependência circular entre magia.mjs e o app.
  const { ConjuradorApp } = await import("./apps/conjurador.mjs");
  return new ConjuradorApp({
    actor, frase, nomeMagia: magia.name, fixa: true, itemMagia: magia
  }).render(true);
}
