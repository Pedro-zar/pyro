/**
 * Regras de técnica (SRD Técnicas): pontos de criação, o que cada traço rende
 * no Esforço escolhido, o limite seguro e a execução em si, com o card de chat.
 *
 * As contas são puras e ficam separadas da execução de propósito: o Executor
 * mostra estamina, limite e efeito antes de gastar, e é a mesma função que
 * cobra depois — a prévia nunca diverge do que aconteceu.
 */
import { PYRO } from "./config.mjs";
import { esc } from "./ui.mjs";
import { prepararFormula, juntarDados } from "./dados.mjs";
import {
  htmlEfeitosDeUso, bonusDeDano, multiplicadoresDeDano, aplicarMultDeDano,
  ajustesDeAtributo, ajustesDeCusto, custoAjustado, operacoesDeAlcance, alcanceAjustado,
  alcanceDaArma, textoDeAlcance
} from "./efeitos.mjs";
import { htmlBotaoSobrecarga, htmlBotaoMira, conferirMira, motivoDaMira } from "./teste.mjs";
import { flagsDoSistema } from "./sistema.mjs";
import { htmlClasseDaRolagem, flagsDaClasse } from "./progressao.mjs";
import { semForNoDano, acoesComConfusao } from "./condicoes.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/* -------------------------------------------------------------------------- */
/*  Pontos de criação                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Ações da arma que a técnica usa como base, ou null quando não há uma.
 *
 * Só a especificidade "arma específica" tem base: nas outras a técnica aceita
 * várias armas, e o custo em ações delas varia — comparar com um número fixo
 * daria ponto ou cobraria ponto pela arma que o jogador escolhesse na hora.
 *
 * O número é o que a arma tinha quando foi escolhida (ver o _preUpdate da
 * técnica): assim a conta continua fechando mesmo que a arma saia da ficha.
 */
export function acoesBaseDaArma(sys) {
  if (PYRO.especificidades[sys?.especificidade]?.filtro !== "ataque") return null;
  const acoes = Number(sys?.ataque?.acoes) || 0;
  return acoes > 0 ? acoes : null;
}

/**
 * Pontos que a diferença de ações rende (SRD Técnicas). Positivo quando a
 * técnica é mais lenta que a arma, negativo quando é mais rápida; zero quando
 * não há arma base contra a qual comparar.
 */
export function ajusteDeAcoes(sys) {
  const base = acoesBaseDaArma(sys);
  if (base === null) return 0;
  return PYRO.pontosDeAcoes(base, Math.max(1, Number(sys?.acoes) || 1));
}

/**
 * Pontos de criação: (nível + especificidade + ações + pontos fracos) x (ranque + 1).
 *
 * Tudo entra no produto: cada concessão que a técnica faz vale mais quanto
 * maior o ranque dela. O nível ocupa o lugar do antigo 1 fixo — no nível 1 a
 * conta é a mesma, e daí para cima a técnica cresce sozinha com o uso, sem
 * precisar de concessão nova.
 *
 * O total pode ficar negativo, e fica de propósito: uma técnica mais rápida do
 * que a arma aguenta não é uma técnica sem pontos, é uma técnica impossível do
 * jeito que está — e o número negativo é o que diz isso na cara da ficha.
 */
export function pontosDaTecnica(sys) {
  const espec = PYRO.especificidades[sys?.especificidade]?.pontos ?? 0;
  const ranque = Math.max(1, Number(sys?.ranque) || 1);
  const nivel = Math.max(1, Number(sys?.progresso?.nivel) || 1);
  const dasAcoes = ajusteDeAcoes(sys);
  const dosOnus = (sys?.onus ?? [])
    .reduce((total, chave) => total + (PYRO.onusTecnica[chave]?.pontos ?? 0), 0);

  const base = nivel + espec + dasAcoes + dosOnus;
  const disponiveis = base * (ranque + 1);
  const gastos = (sys?.tracos ?? [])
    .reduce((total, t) => total + PYRO.custoDoGrau(t.grau), 0);
  return { disponiveis, base, nivel, dasAcoes, dosOnus, gastos, restantes: disponiveis - gastos };
}

/** Traços que cabem nesta ação base; sem `bases` o traço cabe em qualquer uma. */
export function tracosCompativeis(acaoBase) {
  return Object.entries(PYRO.tracosTecnica)
    .filter(([, cfg]) => !cfg.bases?.length || cfg.bases.includes(acaoBase))
    .map(([chave, cfg]) => ({ chave, ...cfg }));
}

/**
 * O que um traço rende: base + porGrau x ((grau - 1) + grau x (Esforço - 1)).
 *
 * O grau move os dois lados da conta — quanto o traço já vale parado e quanto
 * cada Esforço acrescenta —, que é o que separa um traço caro de um barato
 * levado no braço. Esforço 0 é o traço não usado nesta execução.
 */
export function valorDoTraco(cfg, grau, esforco) {
  if (!cfg || esforco <= 0) return 0;
  const porGrau = Number(cfg.porGrau) || 0;
  const g = Math.max(1, grau);
  /*
   * O Esforço SOMA graus, não multiplica o valor: cada ponto além do
   * primeiro rende o que `g` graus renderiam. Uma Linha de base 2 e +1 por
   * grau, comprada no grau 2, vale 3 m no Esforço 1 e ganha 2 m por Esforço
   * (3, 5, 7...). Multiplicar o valor inteiro — o que o sistema fazia —
   * levava a base junto e dava 9 no Esforço 3, e pior: num traço de base
   * negativa (o Desarmar, que começa em -1 dado) o Esforço afundava o valor
   * em vez de melhorá-lo.
   */
  const graus = (g - 1) + g * (esforco - 1);
  const valor = (Number(cfg.base) || 0) + porGrau * graus;
  // Traço de quarto em quarto (a Potência) não pode virar 0,7500000000000001.
  return Math.round(valor * 1000) / 1000;
}

/** Limite seguro de Esforço por traço (SRD Técnicas): DET x 2. */
export function limiteSeguro(actor) {
  return (actor?.system?.det ?? 1) * 2;
}

/**
 * Contabilidade de uma execução: estamina por traço, excesso além do limite
 * seguro e o ND do teste de VIG que o excesso obriga.
 * @param {object[]} usados [{ chave, cfg, grau, esforco }]
 * @param {object[]} [itens] técnica e arma do golpe, para os efeitos que
 *   mexem no custo de estamina (somam ou multiplicam) valerem aqui também.
 */
export function calcularEsforco(actor, usados, itens = []) {
  const limite = limiteSeguro(actor);
  let estamina = 0;
  let excesso = 0;
  let somaEsforcos = 0;

  /*
   * O que os efeitos fazem com o Alcance da técnica. Entra no traço, e não
   * numa linha à parte, porque é o valor do traço que vira o alcance do golpe
   * no card e na variável publicada — anunciá-lo separado deixaria os dois
   * números discordando.
   */
  const opsAlcance = operacoesDeAlcance(actor, itens);
  /*
   * Um golpe tem um alcance só. A tabela de traços é editável pela mesa, e
   * nada impede um segundo traço com regra de mira: o ajuste vale para o
   * primeiro, e não é aplicado de novo no seguinte.
   */
  let alcanceAplicado = false;

  const linhas = usados.map(u => {
    const custo = PYRO.custoDoEsforco(u.esforco);
    const alem = Math.max(0, u.esforco - limite);
    estamina += custo;
    excesso += alem;
    somaEsforcos += u.esforco;
    const base = valorDoTraco(u.cfg, u.grau, u.esforco);
    /*
     * Só o traço que leva o golpe à distância é mexido. O piso de zero mora
     * em alcanceAjustado, e é dele também: traço tem base negativa de
     * propósito (o Desarmar começa em -1 dado), e aparar todos apagaria a
     * desvantagem.
     */
    const ajustar = u.cfg.regra === "mira" && opsAlcance.length > 0 && !alcanceAplicado;
    if (ajustar) alcanceAplicado = true;
    // O traço é a parcela da ordem 2 da conta; as linhas de efeito se
    // encaixam antes ou depois dele conforme a ordem de cada uma.
    const valor = ajustar
      ? alcanceAjustado([{ ordem: PYRO.ORDEM_BASE, valor: base }], opsAlcance)
      : base;
    return { ...u, custo, alem, base, valor };
  });

  /*
   * O ajuste é do TOTAL, e não de cada traço: "metade da estamina" aplicado
   * traço a traço arredondaria para baixo várias vezes e daria um desconto
   * maior que a metade. `estaminaBase` fica para a janela mostrar de onde
   * saiu o número quando algum efeito mexe nele.
   */
  const estaminaBase = estamina;
  estamina = custoAjustado(estamina, ajustesDeCusto(actor, itens).estamina);
  // E então o total volta repartido para as linhas: o que a janela mostra em
  // cada traço tem que somar o que vai ser cobrado.
  if (estamina !== estaminaBase) repartirCusto(linhas, estamina, estaminaBase);

  // O traço de alcance, mexido ou não: é dele que sai a distância do golpe.
  const doTraco = linhas.find(l => l.cfg.regra === "mira");
  const doAlcance = doTraco && doTraco.valor !== doTraco.base ? doTraco : null;

  return {
    linhas, limite, estamina, estaminaBase, excesso, somaEsforcos,
    // Até onde a técnica golpeia por si; 0 quando quem alcança é a arma.
    alcance: doTraco?.valor ?? 0,
    alcanceMudou: !!doAlcance,
    alcanceBase: doAlcance?.base ?? 0,
    alcanceFinal: doAlcance?.valor ?? 0,
    alcanceOrigens: doAlcance ? [...new Set(opsAlcance.map(o => o.nome))] : [],
    // Só o excesso obriga o teste; sem ele a execução é rotineira por regra.
    nd: 10 + somaEsforcos
  };
}

/**
 * Reparte um total ajustado entre as linhas, na proporção do que cada uma
 * custava, guardando o original em `custoBase`.
 *
 * Cada linha fica com a parte inteira da sua fatia e as sobras vão para quem
 * ficou com a maior fração — assim a soma das linhas é exatamente o total,
 * sem o centavo que se perde arredondando cada uma por si.
 */
function repartirCusto(linhas, total, base) {
  if (!linhas.length || base <= 0) return;
  const fatias = linhas.map(l => (total * l.custo) / base);
  const inteiros = fatias.map(Math.floor);
  let sobra = total - inteiros.reduce((t, n) => t + n, 0);
  // Maior fração primeiro; empate fica com a linha mais cara, que é a que
  // menos estranha um ponto a mais.
  const ordem = linhas.map((l, i) => i).sort((a, b) =>
    ((fatias[b] % 1) - (fatias[a] % 1)) || (linhas[b].custo - linhas[a].custo));
  for (const i of ordem) {
    if (sobra <= 0) break;
    inteiros[i] += 1;
    sobra -= 1;
  }
  linhas.forEach((l, i) => {
    l.custoBase = l.custo;
    l.custo = inteiros[i];
  });
}

/* -------------------------------------------------------------------------- */
/*  Ataques disponíveis                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Ataques que a ficha oferece. São as armas do inventário, incluindo as
 * marcadas como ataque desarmado — soco e chute são itens como qualquer
 * outro aqui, montados por quem joga.
 *
 * O alcance de cada uma já vem somado ao do corpo (ver alcanceDaArma).
 *
 * @param {object[]} [opcoes.extras] itens que também contam para os efeitos
 *   presos — a técnica que vai golpear, quando a lista é dela. É o que faz um
 *   "+1 m nesta técnica" esticar a arma que ela usa.
 * @param {boolean} [opcoes.ajustar] false deixa de fora as linhas de efeito,
 *   mantendo o corpo e a arma (ver ataquesDaTecnica).
 */
export function ataquesDoAtor(actor, { extras = [], ajustar = true } = {}) {
  // Técnica aberta fora de uma ficha (do diretório, de um compêndio) não tem
  // inventário nenhum para oferecer.
  return (actor?.items ?? [])
    .filter(i => i.type === "arma")
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map(item => {
      const alcance = alcanceDaArma(actor, item, { extras, efeitos: ajustar });
      return {
        id: item.id,
        nome: item.name,
        item,
        danos: (item.system.danos ?? []).filter(d => d.formula?.trim()),
        acoes: item.system.acoes ?? 2,
        alcance,
        alcanceMenor: alcance.menor,
        alcanceMaximo: alcance.maximo,
        desarmado: !!item.system.desarmado
      };
    });
}

/** Família de uma arma pelo custo em ações (SRD Técnicas: leve, média, pesada). */
export function familiaDoAtaque(ataque) {
  if (ataque.acoes <= 1) return "leve";
  return ataque.acoes === 2 ? "media" : "pesada";
}

/**
 * O ataque atende a condição imposta pela técnica? Alcance e família saem de
 * números que a arma já tem; tipo casa com o tipo de dano da primeira parcela
 * (ou com o desarmado); específica aponta um ataque nomeado.
 */
export function ataqueAtende(ataque, sys) {
  const filtro = PYRO.especificidades[sys?.especificidade]?.filtro ?? "";
  if (!filtro) return true;
  switch (filtro) {
    case "alcance":
      return sys.filtro === "distante" ? ataque.alcanceMaximo > 0 : ataque.alcanceMaximo === 0;
    case "familia":
      return familiaDoAtaque(ataque) === sys.filtro;
    case "tipo":
      return sys.filtro === PYRO.FILTRO_DESARMADO
        ? ataque.desarmado
        : ataque.danos.some(d => d.tipo === sys.filtro);
    case "ataque":
      return ataque.id === sys.ataque?.id;
    default:
      return true;
  }
}

/** A técnica comprou o traço que leva o golpe à distância? */
export function temAlcanceProprio(sys) {
  return tracosDaTecnica(sys).some(t => t.cfg.regra === "mira");
}

/**
 * Ataques que esta técnica aceita. Vazio significa que ela não pode ser usada.
 *
 * O alcance do golpe é um só, e o efeito age uma vez nele. Com o traço
 * Alcance comprado, é o traço que diz até onde o golpe vai, e é nele que o
 * efeito entra (ver calcularEsforco); sem o traço, quem carrega o alcance é a
 * arma, e o efeito entra ali. Somar nos dois mostraria o mesmo "+1 m" duas
 * vezes no mesmo card, como se fossem dois metros.
 *
 * @param {Item} [item] a própria técnica, para os efeitos presos a ela valerem
 *   no alcance da arma que ela vai usar.
 */
export function ataquesDaTecnica(actor, sys, item = null) {
  return ataquesDoAtor(actor, {
    extras: [item].filter(Boolean),
    ajustar: !temAlcanceProprio(sys)
  }).filter(a => ataqueAtende(a, sys));
}

/**
 * Opções do filtro de uma especificidade, ou null quando ela não filtra.
 * O filtro de tipo é montado na hora porque inclui os tipos de dano, que o
 * mestre configura.
 */
export function opcoesDoFiltro(especificidade) {
  const filtro = PYRO.especificidades[especificidade]?.filtro ?? "";
  if (!filtro || filtro === "ataque") return null;
  return filtro === "tipo" ? PYRO.opcoesFiltroTipo() : PYRO.filtrosEspecificidade[filtro] ?? null;
}

/** A condição imposta pela especificidade, em uma linha ("armas cortantes"). */
export function textoDaCondicao(sys) {
  const espec = PYRO.especificidades[sys?.especificidade];
  if (!espec?.filtro) return "";
  if (espec.filtro === "ataque") return sys.ataque?.nome ?? "";
  return loc(opcoesDoFiltro(sys.especificidade)?.[sys.filtro] ?? "");
}

/* -------------------------------------------------------------------------- */
/*  Posturas                                                                  */
/* -------------------------------------------------------------------------- */

/** Habilidades marcadas como postura, na ordem da ficha. */
export function posturasDoAtor(actor) {
  return actor?.items
    .filter(i => i.type === "habilidade" && i.system.ehPostura)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)) ?? [];
}

/**
 * Quem recebe um sussurro sobre este ator: quem joga com ele, mais os mestres.
 * Lista vazia é mensagem pública no Foundry, então quem chama precisa tratar
 * o caso — um card de NPC no chat aberto entrega o inimigo antes da luta.
 */
export function donosDe(actor) {
  const donos = game.users.filter(u => u.isGM || actor.testUserPermission(u, "OWNER"));
  return donos.map(u => u.id);
}

/** O ator é de jogador, ou é do mestre? Decide o que pode sair no chat aberto. */
export function temDonoJogador(actor) {
  return game.users.some(u => !u.isGM && actor?.testUserPermission(u, "OWNER"));
}

/**
 * Lembrete de postura no começo do combate: um card por ficha que tem
 * posturas, sussurrado para quem joga com ela, com um botão por postura.
 *
 * Entrar numa postura é a coisa mais fácil de esquecer na primeira rodada, e
 * o preço de lembrar depois é uma ação. Quem já está numa continua recebendo
 * o card, com a ativa marcada: trocar de guarda no início da luta é uma
 * decisão tão comum quanto entrar na primeira.
 */
export async function lembrarPosturas(combate) {
  const vistos = new Set();
  for (const combatente of combate?.combatants ?? []) {
    const actor = combatente.actor;
    if (!actor || vistos.has(actor.uuid)) continue;
    vistos.add(actor.uuid);

    const posturas = posturasDoAtor(actor);
    if (!posturas.length) continue;

    // Sem ninguém para sussurrar, o card seria público — e um lembrete público
    // com as posturas de um NPC entrega a luta antes dela começar.
    const ouvintes = donosDe(actor);
    if (!ouvintes.length) continue;

    const ativa = actor.posturaAtiva?.id;
    const botoes = posturas.map(p => `<button type="button" class="pyro-entrar-postura${
      p.id === ativa ? " ativa" : ""}" data-ator-uuid="${actor.uuid}" data-item-id="${p.id}">
      <img src="${esc(p.img)}" alt="" /> ${esc(p.name)}
    </button>`).join("");

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper: ouvintes,
      content: `<div class="pyro-chat pyro-lembrete-postura">
        <header class="pyro-item-topo">
          <img src="${esc(actor.img)}" alt="" />
          <div><h3>${esc(actor.name)}</h3>
            <span class="pyro-item-meta">${loc("PYRO.Postura.LembreteMeta")}</span></div>
        </header>
        <p class="pyro-nota">${loc("PYRO.Postura.LembreteDica")}</p>
        <div class="pyro-acoes-card">${botoes}</div>
      </div>`
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Execução                                                                  */
/* -------------------------------------------------------------------------- */

/** Traços comprados desta técnica, já com a configuração e o rótulo de cada um. */
export function tracosDaTecnica(sys) {
  return (sys?.tracos ?? [])
    .map(t => {
      const cfg = PYRO.tracosTecnica[t.chave];
      return cfg ? { chave: t.chave, cfg, grau: Math.max(1, t.grau) } : null;
    })
    .filter(Boolean);
}

/**
 * Número de traço em texto. A Potência anda de 0,25 em 0,25, e "0.75" com
 * ponto não é como se escreve um número aqui.
 *
 * A vírgula não vem de game.i18n.lang: o Foundry pode estar em inglês com o
 * sistema em português, e aí o mesmo painel mostraria "2.25x" no meio de
 * textos em português.
 */
export function numeroDoTraco(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/**
 * Texto de um valor de traço ("3 m", "1,25 x dados de dano").
 *
 * Multiplicador é o único que não sai como o traço rendeu: a Potência soma
 * um quarto por vez, e quem lê a ficha quer o total que vai multiplicar os
 * dados — "0,25 x dados de dano" leria como se o golpe encolhesse.
 */
export function textoDoValor(cfg, valor) {
  const total = cfg?.regra === "danoMult" ? 1 + valor : valor;
  return `${numeroDoTraco(total)} ${loc(cfg?.unidade)}`;
}

/** Texto do que um traço rende ("+3 m", "1,25 x dados de dano"). */
export function textoDoTraco(linha) {
  return textoDoValor(linha.cfg, linha.valor);
}

/* -------------------------------------------------------------------------- */
/*  Prévia do ataque final                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Multiplicador de dano da execução: 1 mais o que a Potência somar. Ele não
 * mexe nos dados — multiplica o TOTAL rolado, na mesma conta dos
 * multiplicadores de efeito: floor(base x mult da técnica x mult do efeito).
 */
export function multiplicadorDeDano(calc) {
  return 1 + calc.linhas
    .filter(l => l.cfg.regra === "danoMult")
    .reduce((total, l) => total + l.valor, 0);
}

/**
 * O que a execução vai produzir, em texto: as fórmulas de dano da arma, o
 * multiplicador do total e uma linha por característica.
 *
 * É a mesma conta de usarTecnica sobre o mesmo calc — a janela mostra o que
 * vai sair, e não uma segunda versão da regra que pode divergir dela.
 *
 * Dano de mesmo tipo sai numa linha só: uma arma de "6d8 + 2d10" cortante
 * aparece somada, como aparece na rolagem.
 */
export function resumoDaTecnica(actor, item, calc, ataque) {
  const mult = multiplicadorDeDano(calc);
  const porTipo = new Map();
  const somar = (tipo, formula) => porTipo.set(tipo, [...(porTipo.get(tipo) ?? []), formula]);

  // As fórmulas saem cruas: a Potência multiplica o total rolado, e a prévia
  // a anuncia como linha própria (resumo.mult), não dentro dos dados.
  for (const dano of ataque?.danos ?? []) somar(dano.tipo, dano.formula);
  for (const bonus of ataque ? bonusDeDano(actor, [item, ataque.item]) : []) {
    somar(bonus.tipo || ataque.danos[0]?.tipo || "", bonus.formula);
  }

  const dano = [...porTipo].map(([tipo, partes]) => ({
    tipo,
    rotulo: tipo ? loc(PYRO.tiposDano[tipo]?.label ?? `PYRO.Dano.${tipo}`) : loc("PYRO.Item.Dano"),
    formula: juntarDados(partes)
  }));

  return {
    mult,
    dano,
    // A Potência já está no dano; repetir "0,25 x dados de dano" ao lado dele
    // seria a mesma informação duas vezes.
    caracteristicas: calc.linhas
      .filter(l => l.cfg.regra !== "danoMult")
      .map(l => ({
        nome: loc(l.cfg.label ?? l.chave),
        texto: textoDoTraco(l),
        // O traço de alcance mexido por efeito diz de onde veio o número, na
        // janela como no card: ver o traço já em 4 m sem explicação parece
        // conta errada do Esforço.
        origens: l.valor !== l.base ? calc.alcanceOrigens.join(", ") : ""
      }))
  };
}

/**
 * Executa a técnica: cobra a estamina, testa o excesso de Esforço, rola o
 * ataque quando a ação base tem um, e publica o card.
 *
 * @param {object} escolhas
 * @param {Record<string, number>} escolhas.esforcos Esforço por chave de traço.
 * @param {string} [escolhas.ataqueId] ataque escolhido, quando a base ataca.
 */
export async function usarTecnica(actor, item, { esforcos = {}, ataqueId = null } = {}) {
  // Também aqui, e não só na abertura do executor: a janela pode estar aberta
  // desde antes de a mochila ficar pesada demais.
  if (actor && !actor.podeAgir()) return;
  const sys = item.system;
  const base = PYRO.acoesBaseTecnica[sys.acaoBase];
  const usados = tracosDaTecnica(sys)
    // Esforço mínimo 1, como a Intenção das magias: um traço só entra na
    // execução fazendo alguma coisa.
    .map(t => ({ ...t, esforco: Math.max(1, Math.round(Number(esforcos[t.chave]) || 0)) }));

  const ataque = base?.ataca && ataqueId
    ? ataquesDaTecnica(actor, sys, item).find(a => a.id === ataqueId) ?? null
    : null;
  const calc = calcularEsforco(actor, usados, [item, ataque?.item]);

  /* --- Custos: estamina do Esforço, e os PV do ônus que os pede ----------- */
  const custaPv = (sys.onus ?? []).some(o => PYRO.onusTecnica[o]?.regra === "custaPv");
  // O ônus cobra vida além da estamina, no valor do Esforço em si: Esforço 2
  // num traço custa 6 de estamina (a tabela do Esforço) e 2 de vida.
  const cobraPv = custaPv && calc.somaEsforcos > 0;
  const pago = await actor.pagarCustos({ estamina: calc.estamina });
  if (!pago) return;
  if (cobraPv) {
    const pv = actor.system.recursos.pv;
    await actor.update({ "system.recursos.pv.value": Math.max(0, pv.value - calc.somaEsforcos) });
  }

  /*
   * Sem excesso não há teste, e sem teste a execução é rotineira (SRD 3b).
   * Com excesso, quem mede a dificuldade é o teste de sobrecarga — que sai do
   * botão do card, e leva a classe e o "contar uso" junto.
   */
  const classe = calc.excesso > 0 ? null : "rotineira";

  /* --- Card ---------------------------------------------------------------- */
  const rolls = [];
  const partes = [];
  const danos = [];

  const acoesBase = custoAjustado(sys.acoes, ajustesDeCusto(actor, [item, ataque?.item]).acoes);
  // A confusão cobra a ação extra por último, sobre o custo já ajustado — e só
  // em ação: a regra fala de ações, e técnica de reação continua custando o
  // que custava.
  const acoes = base?.reacao ? acoesBase : acoesComConfusao(actor, acoesBase);
  const chaveCusto = base?.reacao ? "PYRO.Chat.CustoReacoes" : "PYRO.Chat.CustoAcoes";
  // Dizer que a ação a mais veio da confusão: sem isso o custo maior parece
  // conta errada.
  const notaConfusao = acoes > acoesBase ? loc("PYRO.Mental.ConfusaoAcao") : "";
  const meta = [
    loc(chaveCusto, { acoes }),
    loc(base?.label ?? ""),
    /*
     * Estamina e vida saem na mesma linha: o ônus "custa PV" cobra os dois
     * pelo mesmo Esforço, e uma segunda linha dizendo "pagou X de PV pelo
     * ponto fraco" repetia o número que já está aqui.
     */
    calc.estamina || cobraPv
      ? loc(cobraPv ? "PYRO.Chat.CustoEstaminaEVida" : "PYRO.Chat.CustoEstamina",
            // Os dois números são diferentes: a estamina sai da tabela de
            // custo do Esforço e a vida é o Esforço em si.
            { valor: calc.estamina, pv: calc.somaEsforcos })
      : null,
    // De onde veio o número, quando um efeito mexeu no custo.
    calc.estamina !== calc.estaminaBase
      ? loc("PYRO.Tecnica.EstaminaAjustada", { base: calc.estaminaBase })
      : null,
    notaConfusao || null,
    ataque ? esc(ataque.nome) : null,
    /*
     * O alcance da arma do golpe, na mesma condição da prévia do Executor: a
     * arma chega longe, ou um efeito esticou o corpo a corpo. A janela e o
     * card mostram a mesma coisa, que é a regra da casa aqui.
     */
    ataque && (ataque.alcanceMaximo > 0 || ataque.alcance.mudou)
      ? textoDeAlcance(ataque.alcance) : null
  ].filter(Boolean).join(" · ");

  partes.push(`<header class="pyro-item-topo">
    <img src="${item.img}" alt="" />
    <div><h3>${esc(item.name)}</h3><span class="pyro-item-meta">${meta}</span></div>
  </header>`);

  // Variação da postura ativa: a mesma técnica muda de forma conforme a guarda.
  const postura = actor.posturaAtiva;
  const variacao = postura
    ? (sys.variacoes ?? []).find(v => v.posturaId === postura.id && v.texto?.trim())
    : null;
  if (variacao) {
    partes.push(`<p class="pyro-postura-variacao"><strong>${esc(postura.name)}:</strong> ${esc(variacao.texto)}</p>`);
  }

  if (calc.linhas.length) {
    partes.push(`<ul class="pyro-tracos">${calc.linhas.map(l => `<li${l.alem ? ` class="alem-limite"` : ""}>
      <strong>${loc(l.cfg.label ?? l.chave)}</strong>
      <span class="pyro-traco-meta">${loc("PYRO.Tecnica.Grau")} ${l.grau} ·
        ${loc("PYRO.Tecnica.Esforco")} ${l.esforco} ·
        ${loc("PYRO.Tecnica.CustoEmEstamina", { valor: l.custo })}</span>
      <span class="pyro-traco-valor">${textoDoTraco(l)}</span>
    </li>`).join("")}</ul>`);
  }

  // O Esforço além do limite cobra um teste de VIG; o dado é rolado no botão,
  // quando quem se esforçou estiver pronto para encarar a conta.
  if (calc.excesso > 0) {
    partes.push(htmlBotaoSobrecarga({
      atorUuid: actor.uuid,
      itemUuid: item.uuid,
      atributo: "vig",
      nd: calc.nd,
      exaustao: calc.excesso,
      // "+2 VIG com a katana" vale no teste da técnica que golpeia com ela.
      bonusAtributo: ajustesDeAtributo(actor, [item, ataque?.item]).vig ?? 0,
      motivo: loc("PYRO.Tecnica.LimitePendente", { excesso: calc.excesso, nd: calc.nd })
    }));
  }

  /* --- Dano do ataque, com o multiplicador da Potência --------------------- */
  const mult = multiplicadorDeDano(calc);

  if (ataque) {
    for (const dano of ataque.danos) {
      // Os dados rolam crus: a Potência multiplica o total, mais abaixo.
      const formula = dano.formula;
      const dados = semForNoDano(actor, item.getRollData());
      const roll = await new Roll(prepararFormula(formula, dados), dados).evaluate();
      rolls.push(roll);
      danos.push({ tipo: dano.tipo, total: roll.total, formula });
      const rotulo = loc(PYRO.tiposDano[dano.tipo]?.label ?? dano.tipo ?? "");
      partes.push(`<p class="pyro-linha-dano dano-${dano.tipo}">${rotulo}</p>`, await roll.render());
    }
    // A arma do golpe entra junto: dano extra preso a ela vale na técnica.
    for (const bonus of bonusDeDano(actor, [item, ataque.item])) {
      const dados = semForNoDano(actor, item.getRollData());
      const roll = await new Roll(prepararFormula(bonus.formula, dados), dados).evaluate();
      rolls.push(roll);
      danos.push({
        tipo: bonus.tipo || ataque.danos[0]?.tipo || "",
        total: roll.total,
        formula: bonus.formula
      });
      partes.push(`<p class="pyro-linha-dano">${esc(bonus.nome)}</p>`, await roll.render());
    }
    /*
     * A Potência e os multiplicadores de efeito entram na MESMA aplicação,
     * cada um como fator próprio: floor(base x mult1 x mult2), um
     * arredondamento só do produto — multiplicar arredondado sobre
     * arredondado comeria dano à toa.
     */
    const mults = multiplicadoresDeDano(actor, [item, ataque.item]);
    if (mult !== 1) {
      const nomes = calc.linhas.filter(l => l.cfg.regra === "danoMult" && l.valor)
        .map(l => loc(l.cfg.label ?? l.chave)).join(", ");
      mults.push({ tipo: "", fator: mult, nome: nomes || loc("PYRO.Previa.Multiplicador") });
    }
    for (const nota of aplicarMultDeDano(danos, mults)) {
      partes.push(`<p class="pyro-nota">${nota}</p>`);
    }
  }

  /*
   * Pontaria: a mesma regra de qualquer ataque. Com um alvo marcado além da
   * zona livre da criatura, a técnica pede o teste; sem alvo, só quando ela
   * tem como chegar além dela — pelo traço Alcance ou pela arma do golpe.
   */
  const alcanceDoGolpe = calc.alcance || ataque?.alcanceMaximo || ataque?.alcanceMenor || 0;
  const mira = conferirMira(actor, alcanceDoGolpe);
  if (mira.pede) {
    partes.push(htmlBotaoMira({
      atorUuid: actor.uuid,
      itemUuid: item.uuid,
      distancia: mira.distancia ?? "",
      limite: mira.limite,
      alcance: calc.alcance || ataque?.alcanceMenor || 0,
      motivo: motivoDaMira(mira)
    }));
  }

  /*
   * Metros de efeito, nos dois alcances que a técnica tem: o do traço e o da
   * arma do golpe. Sem a nota, o traço que rendia 3 m aparecendo como 4 m
   * pareceria a conta do Esforço errada.
   */
  if (calc.alcanceMudou) {
    partes.push(`<p class="pyro-nota">${loc("PYRO.Efeitos.AlcanceTecnica", {
      nomes: esc(calc.alcanceOrigens.join(", ")),
      antes: numeroDoTraco(calc.alcanceBase),
      depois: numeroDoTraco(calc.alcanceFinal)
    })}</p>`);
  }
  if (ataque?.alcance.mudou) {
    partes.push(`<p class="pyro-nota">${loc("PYRO.Efeitos.AlcanceArmaNota", {
      arma: esc(ataque.nome),
      nomes: esc(ataque.alcance.nomes.join(", ")),
      antes: textoDeAlcance(ataque.alcance.base),
      depois: textoDeAlcance(ataque.alcance)
    })}</p>`);
  }

  // Sem estamina bastante, parte do custo saiu do PV — isso é outra coisa, e
  // continua avisado à parte do ônus que cobra vida de propósito.
  if (pago.dosPv) partes.push(`<p class="pyro-nota">${loc("PYRO.Chat.CustoPv", { valor: pago.dosPv })}</p>`);

  // Os efeitos de uso da arma do golpe também entram no card da técnica.
  partes.push(htmlEfeitosDeUso(item, ataque?.item));
  partes.push(htmlClasseDaRolagem(classe, item));

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="pyro-chat pyro-tecnica">${partes.join("")}</div>`,
    rolls,
    flags: flagsDoSistema({
      danos, cura: 0,
      variaveis: {
        esforco: calc.somaEsforcos,
        estamina: calc.estamina,
        acoes,
        danoTotal: danos.reduce((t, d) => t + d.total, 0),
        ...Object.fromEntries(calc.linhas.map(l => [l.chave, l.valor]))
      },
      ...flagsDaClasse(classe, item)
    }),
    sound: rolls.length ? CONFIG.sounds.dice : undefined
  });
}

/**
 * Abre o Executor da técnica. Fica aqui, e não na ficha, porque o "usar" do
 * item precisa chegar ao mesmo lugar que o botão da lista.
 */
export async function executarTecnica(actor, item) {
  if (actor && !actor.podeAgir()) return;
  const { ExecutorApp } = await import("./apps/executor.mjs");
  return new ExecutorApp({ actor, item }).render(true);
}
