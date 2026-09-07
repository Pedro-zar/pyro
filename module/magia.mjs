/**
 * Regras de magia (SRD Magia): escalonamentos das runas, custo e sobrecarga
 * de uma frase rúnica e a conjuração em si, com o card de chat.
 */
import { PYRO } from "./config.mjs";
import { esc } from "./ui.mjs";
import { formulaTeste, poolDoAtributo, juntarDados, expandirAtributos } from "./dados.mjs";
import {
  htmlEfeitosDeUso, htmlEfeitosDeRegra, bonusDeDano, ajustesDeCusto, custoAjustado,
  aplicarExaustao, penalidadeExaustao
} from "./efeitos.mjs";
import { flagsDoSistema } from "./sistema.mjs";
import { classificarRolagem, poolDoTeste, htmlClasseDaRolagem, flagsDaClasse } from "./progressao.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** Tipo de dano que desliga a rolagem: a runa só produz efeito e números. */
export const SEM_DANO = "nenhum";

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
 * Valor de um escalonamento na conjuração: a Intenção efetiva da runa (já com
 * o que o Toque emprestou) e o multiplicador de efeito da língua.
 * @param {object} pr entrada de calc.porRuna.
 */
export function valorEfetivo(pr, scaling) {
  const bruto = valorScaling(scaling, pr.intencaoEfetiva ?? pr.intencao);
  return pr.efeitoMult !== 1 ? Math.floor(bruto * pr.efeitoMult) : bruto;
}

/** Escalonamento de uma runa pela chave de variável ("passos", "alvos"). */
export function scalingPorChave(scalings, chave) {
  return (scalings ?? []).find(sc => chaveVariavel(sc.nome) === chave) ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Gestos com regra própria                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Os três gestos que mudam a conjuração. Todo o resto é número, e número mora
 * na runa do compêndio: um gesto novo só precisa dos escalonamentos certos.
 */
export const GESTOS_COM_REGRA = ["toque", "longo", "dividir"];

/**
 * Que gesto conhecido esta runa é, pelo nome que a mesa deu a ela. Um gesto
 * chamado "Toque" empresta Intenção venha ele do compêndio ou da mão do
 * jogador; renomeá-lo para outra coisa o deixa sem regra, só com os números.
 * @returns {string|null} chave do gesto (toque, longo, dividir...) ou null.
 */
export function regraDoGesto(item) {
  if (item.system.tipoRuna === "elemento") return null;
  const alvo = PYRO.normalizarTexto(item.system.palavra || item.name);
  for (const [chave, cfg] of Object.entries(PYRO.gestosNomeados())) {
    if (alvo === chave || alvo === PYRO.normalizarTexto(game.i18n.localize(cfg.label))) return chave;
  }
  return null;
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
    const valor = valorEfetivo(pr, sc);
    if (sc.faces > 0) return `${Math.max(1, valor)}d${sc.faces}${tipo ? ` ${tipo}` : ""}`;
    const nome = sc.nome?.trim();
    const final = chaveVariavel(sc.nome) === "alcance" ? PYRO.subirAlcance(valor, passos) : valor;
    return nome ? `${nome} ${final}` : String(final);
  }).filter(Boolean).join(" · ");
  return texto || (semDano ? loc("PYRO.Dano.nenhum") : "");
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

  // Toque: cada Intenção nele dá +1 de Intenção a uma runa escolhida na frase.
  for (const toque of doGesto("toque")) {
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
    // 1 ação por runa verbal ou somática (SRD §5), antes dos efeitos.
    acoes: custoAjustado(escolhas.length, ajustes.acoes),
    nd: 10 + somaIntencoes,
    // DT para resistir à magia: a SAB de quem conjura (SRD Magia).
    dt: actor.system.atributos.sab.efetivo,
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
  nomeMagia = null, rolarDano = true, itemMagia = null, recursoMental = "mana"
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
  let testeRoll = null;
  let falhou = false;
  // Sem teste de sobrecarga a conjuração é rotineira por regra (SRD Magia).
  let classe = "rotineira";
  if (calc.sobrecarga > 0) {
    const pen = penalidadeExaustao(actor);
    const sab = actor.system.atributos.sab.efetivo;
    const ajustes = { bonus: pen.bonus, desvantagem: pen.desvantagem };
    const formula = formulaTeste(sab, ajustes);
    classe = classificarRolagem({ ...poolDoTeste(poolDoAtributo(sab), ajustes), nd: calc.nd });
    if (formula === null) {
      falhou = true; // pool zerada: falha automática, sem rolagem
    } else {
      testeRoll = await new Roll(formula).evaluate();
      falhou = testeRoll.total < calc.nd;
    }
  }

  /* --- Gasto de mana (a magia sai de qualquer jeito) ---------------------- */
  await actor.update({ "system.recursos.mana.value": recursos.mana.value - calc.custoTotal });

  /* --- Sobrecarga: exaustão no lugar dos efeitos escalonados -------------- */
  /*
   * Falhou no teste, ganha exaustão igual ao nível da sobrecarga — somada à
   * que já tinha (2 + 2 = 4). Cada nível tira 1 de todos os testes. A magia é
   * conjurada mesmo assim: o preço é o corpo, não o feitiço.
   */
  const efeitosSobrecarga = [];
  if (calc.sobrecarga > 0 && falhou) {
    const total = await aplicarExaustao(actor, calc.sobrecarga);
    efeitosSobrecarga.push(loc("PYRO.Sobrecarga.Exaustao", {
      niveis: calc.sobrecarga, total
    }));
  }

  /* --- Montagem do card e rolagens ---------------------------------------- */
  const rolls = testeRoll ? [testeRoll] : [];
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
   * DT para resistir: a SAB de quem conjura (SRD Magia). Magia mental é
   * resistida com um teste de SAB do alvo, no lugar da esquiva.
   */
  const ehMental = calc.porRuna.some(pr =>
    (pr.tipoDano || PYRO.elementos[pr.item.system.subtipo]?.tipoDano) === "mental");
  partes.push(`<p class="pyro-dt">${loc("PYRO.Magia.DT", { valor: calc.dt })}${
    ehMental ? ` ${loc("PYRO.Magia.DTMental")}` : ""}</p>`);

  // Teste de sobrecarga: falhar custa exaustão, nunca a magia.
  if (calc.sobrecarga > 0) {
    partes.push(`<div class="pyro-sobrecarga ${falhou ? "falha" : "sucesso"}">
      <p>${loc("PYRO.Sobrecarga.Teste", { nivel: calc.sobrecarga, nd: calc.nd, total: testeRoll?.total ?? 0 })}
      — <strong>${loc(falhou ? "PYRO.Chat.Falha" : "PYRO.Chat.Sucesso")}</strong></p>
      ${!falhou ? `<p>${loc("PYRO.Sobrecarga.Resistiu")}</p>` : ""}
      ${efeitosSobrecarga.length ? `<ul>${efeitosSobrecarga.map(e => `<li>${e}</li>`).join("")}</ul>` : ""}
    </div>`);
  }

  /* --- Números e dados de cada runa --------------------------------------- */
  /*
   * Dados e números são juntados antes de sair no card: dois elementos de
   * calor viram uma rolagem de dano só, e dois gestos que aumentam a mesma
   * coisa ("Duração") viram uma linha com a soma. Assim gestos que se
   * acumulam funcionam sem o sistema conhecer cada um pelo nome.
   */
  const gruposDeDano = new Map();
  const numeros = new Map();
  const efeitosDeTexto = [];
  const subjulgares = [];

  const somarDano = (tipo, parte, origem, nomeScaling = null) => {
    const grupo = gruposDeDano.get(tipo) ?? { partes: [], origens: new Set(), scalings: new Set() };
    grupo.partes.push(parte);
    grupo.origens.add(origem);
    if (nomeScaling) grupo.scalings.add(nomeScaling);
    gruposDeDano.set(tipo, grupo);
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
      const valor = valorEfetivo(pr, sc);
      if (sc.faces > 0) {
        if (semDano) continue;
        const formula = `${Math.max(1, valor)}d${sc.faces}`;
        // Subjulgar não causa dano direto: cada rolagem é comparada com a
        // vida do alvo por si, então fica fora do agrupamento.
        if (pr.subjulgar) subjulgares.push({ nomeRuna, formula });
        else somarDano(tipoDano, formula, nomeRuna, sc.nome);
        continue;
      }
      somarNumero(sc.nome || loc("PYRO.Scaling.Efeito"), valor, nomeRuna);
    }

    // Número que o elemento publica sozinho (empurrão do vento, defesa da pedra).
    if (elCfg?.variavel) variaveis[elCfg.variavel] = pr.intencaoEfetiva;
    if (elCfg?.efeito) efeitosDeTexto.push(loc(elCfg.efeito));
  }

  /* --- Números, um por escalonamento --------------------------------------- */
  for (const [nome, grupo] of numeros) {
    // Alcance é o número que o gesto Longo move na escada de passos.
    const final = chaveVariavel(nome) === "alcance"
      ? PYRO.subirAlcance(grupo.valor, calc.passosAlcance)
      : grupo.valor;
    publicar(nome, final);
    const nota = final !== grupo.valor
      ? ` <em>${loc("PYRO.Magia.PorPassos", { de: grupo.valor, passos: calc.passosAlcance })}</em>` : "";
    const origens = [...grupo.origens].map(esc).join(", ");
    partes.push(`<p class="pyro-forma"><strong>${esc(nome)}</strong> — ${origens}: ${final}${nota}</p>`);
  }

  /*
   * Bônus de dano de efeitos ("Foco em Fogo: 2d6") entram no grupo do tipo
   * deles, e não como uma rolagem à parte: quem recebe o dano soma uma vez só.
   */
  if (rolarDano) {
    for (const bonus of bonusDeDano(actor, itemMagia)) {
      somarDano(bonus.tipo || [...gruposDeDano.keys()][0] || "", bonus.formula, bonus.nome);
    }
  }

  /* --- Dano, um bloco por tipo -------------------------------------------- */
  let seis = 0;
  for (const [tipo, grupo] of gruposDeDano) {
    const formula = juntarDados(grupo.partes);
    const rotulo = tipo
      ? loc(PYRO.tiposDano[tipo]?.label ?? `PYRO.Dano.${tipo}`)
      : loc("PYRO.Item.Dano");
    const origens = [...grupo.origens].map(esc).join(", ");
    if (!rolarDano) {
      partes.push(`<p class="pyro-forma"><strong>${rotulo}</strong> — ${origens}: ${formula} (${loc("PYRO.Chat.NaoRolado")})</p>`);
      continue;
    }
    const roll = await new Roll(expandirAtributos(formula), actor.getRollData()).evaluate();
    rolls.push(roll);
    if (tipo === "cura") totalCura += roll.total;
    else {
      danos.push({ tipo, total: roll.total });
      seis += contarSeis(roll);
    }
    // O total do grupo vale para cada escalonamento que entrou nele: um efeito
    // que escreve "@dano" recebe o dano daquele tipo, já somado.
    for (const nomeSc of grupo.scalings) publicar(nomeSc, roll.total);
    partes.push(`<div class="pyro-dano dano-${tipo || "simples"}">
      <p><strong>${rotulo}</strong> — ${origens}: ${formula}</p>
      ${await roll.render()}
    </div>`);
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
  for (const sub of subjulgares) {
    if (!rolarDano) {
      partes.push(`<p class="pyro-forma"><strong>${esc(sub.nomeRuna)}:</strong> ${sub.formula} (${loc("PYRO.Chat.NaoRolado")})</p>`);
      continue;
    }
    const roll = await new Roll(sub.formula).evaluate();
    rolls.push(roll);
    partes.push(`<div class="pyro-dano">
      <p><strong>${esc(sub.nomeRuna)}</strong>: ${sub.formula}</p>
      ${await roll.render()}
    </div>`);
    partes.push(tabelaSubjulgar(actor.system.det, roll.total));
  }

  // Efeito de referência de cada elemento, depois dos números que ele rendeu.
  for (const texto of efeitosDeTexto) partes.push(`<p class="pyro-efeito">${texto}</p>`);

  /* --- Efeitos que o card aplica em um clique ----------------------------- */
  const efeitosRegra = calc.porRuna
    .filter(pr => pr.item.system.tipoRuna === "elemento" && PYRO.efeitosDeElemento[pr.item.system.subtipo])
    .map(pr => PYRO.efeitosDeElemento[pr.item.system.subtipo](pr.intencaoEfetiva));
  if (efeitosRegra.length) partes.push(htmlEfeitosDeRegra(efeitosRegra));

  // Botões dos efeitos de uso: os da magia salva e os das runas da frase.
  partes.push(htmlEfeitosDeUso(itemMagia, calc.porRuna.map(pr => pr.item)));
  // Só magia salva progride: frase montada na hora não tem onde contar o uso.
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
