/**
 * Regras de magia (SRD Magia): escalonamentos das runas, custo e sobrecarga
 * de uma frase rúnica e a conjuração em si, com o card de chat.
 */
import { PYRO } from "./config.mjs";
import { esc } from "./ui.mjs";
import { formulaTeste, poolDoAtributo } from "./dados.mjs";
import {
  htmlEfeitosDeUso, bonusDeDano, ajustesDeCusto, custoAjustado,
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
 * Gestos são texto livre: a forma reconhecida sai da palavra ou do nome
 * ("Explosão" -> explosao), e é ela que dá os escalonamentos padrão.
 */
export function identificarForma(item) {
  const alvo = PYRO.normalizarTexto(item.system.palavra || item.name);
  for (const [k, v] of Object.entries(PYRO.formas)) {
    if (alvo === k || alvo === PYRO.normalizarTexto(game.i18n.localize(v.label))) return k;
  }
  return null;
}

/**
 * Escalonamentos padrão de uma runa, ao salvar uma magia no grimório.
 * Elementos: dados de dano da tabela (base = Intenção 1; porIntencao derivado).
 * Formas: os números da descrição (alcance/raio/extensão/PV/rodadas).
 */
export function scalingsPadrao(item) {
  const sys = item.system;

  if (sys.tipoRuna === "elemento") {
    const cfg = PYRO.elementos[sys.subtipo];
    if (!cfg || !cfg.faces) return [];
    return [
      {
        nome: loc("PYRO.Scaling.Dano"),
        base: cfg.base,
        porIntencao: cfg.porIntencao,
        faces: cfg.faces
      },
      // Efeitos próprios do elemento que também escalam (corrente do raio).
      ...(cfg.extras ?? []).map(e => ({ ...e, nome: loc(e.nome) }))
    ];
  }

  if (sys.tipoRuna === "forma") {
    const chave = identificarForma(item);
    const padroes = {
      projetil: [{ nome: loc("PYRO.Scaling.Alcance"), base: 6, porIntencao: 4, faces: 0 }],
      explosao: [{ nome: loc("PYRO.Scaling.Raio"), base: 1, porIntencao: 1, faces: 0 }],
      cone:     [{ nome: loc("PYRO.Scaling.Alcance"), base: 3, porIntencao: 2, faces: 0 }],
      linha:    [{ nome: loc("PYRO.Scaling.Comprimento"), base: 6, porIntencao: 4, faces: 0 }],
      muro: [
        { nome: loc("PYRO.Scaling.Extensao"), base: 3, porIntencao: 2, faces: 0 },
        { nome: loc("PYRO.Scaling.PvMuro"), base: 5, porIntencao: 5, faces: 0 }
      ],
      aura:  [{ nome: loc("PYRO.Scaling.Rodadas"), base: 1, porIntencao: 1, faces: 0 }],
      toque: [{ nome: loc("PYRO.Scaling.IntencaoExtra"), base: 1, porIntencao: 1, faces: 0 }]
    };
    return padroes[chave] ?? [];
  }

  return [];
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
 * O que uma runa produz numa Intenção, em texto curto ("9d6 calor",
 * "raio 2m"). Alimenta a prévia do conjurador: o jogador vê o efeito antes
 * de gastar mana, e não só depois no card do chat. É a mesma conta da
 * conjuração, sobre os mesmos escalonamentos.
 * @param {number} [efeitoMult] multiplicador de efeito da língua da runa.
 * @param {object[]|null} [scalingsOverride] cópia editada de uma magia salva,
 *   que vale no lugar dos escalonamentos da runa.
 * @param {string|null} [tipoDanoOverride] idem, para o tipo de dano.
 */
export function previaRuna(item, intencao, efeitoMult = 1, scalingsOverride = null, tipoDanoOverride = null) {
  const sys = item.system;
  const scalings = scalingsOverride ?? sys.scalings ?? [];
  const cfg = sys.tipoRuna === "elemento" ? PYRO.elementos[sys.subtipo] : null;
  const tipoChave = (tipoDanoOverride ?? sys.tipoDano) || cfg?.tipoDano || "";
  const semDano = tipoChave === SEM_DANO;
  const tipo = tipoChave && !semDano
    ? loc(PYRO.tiposDano[tipoChave]?.label ?? `PYRO.Dano.${tipoChave}`) : "";
  // Runa sem dano não rola nada: só os escalonamentos numéricos aparecem.
  const texto = scalings.map(sc => {
    if (sc.faces > 0 && semDano) return null;
    let v = valorScaling(sc, intencao);
    if (efeitoMult !== 1) v = Math.max(sc.faces > 0 ? 1 : 0, Math.floor(v * efeitoMult));
    if (sc.faces > 0) return `${Math.max(1, v)}d${sc.faces}${tipo ? ` ${tipo}` : ""}`;
    const nome = sc.nome?.trim();
    return nome ? `${nome} ${v}` : String(v);
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

  for (const { item, intencao, scalings, subjulgar, tipoDano } of escolhas) {
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
      item, intencao, custo, limite, excesso,
      // Frase montada na hora usa o que a runa define; magia salva traz a
      // própria cópia (escalonamentos, Subjulgar e tipo de dano) por cima.
      scalings: scalings ?? sys.scalings ?? [],
      subjulgar: subjulgar ?? sys.subjulgar ?? false,
      tipoDano: tipoDano ?? sys.tipoDano ?? "",
      efeitoMult: lingua.efeito
    });
  }

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
    // 1 ação por runa verbal ou somática (SRD §5), antes dos efeitos.
    acoes: custoAjustado(escolhas.length, ajustes.acoes),
    nd: 10 + somaIntencoes,
    temElemento: escolhas.some(e => e.item.system.tipoRuna === "elemento"),
    temForma: escolhas.some(e => e.item.system.tipoRuna === "forma")
  };
}

/* -------------------------------------------------------------------------- */
/*  Conjuração                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Conjura a frase: valida, gasta mana, testa sobrecarga, rola os dados e
 * publica o card no chat.
 * @param {object} [opcoes.itemMagia] magia do grimório de origem, quando houver.
 */
export async function conjurar(actor, escolhas, {
  nomeMagia = null, rolarDano = true, itemMagia = null
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
  const subjulgares = [];

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

  // Teste de sobrecarga: falhar custa exaustão, nunca a magia.
  if (calc.sobrecarga > 0) {
    partes.push(`<div class="pyro-sobrecarga ${falhou ? "falha" : "sucesso"}">
      <p>${loc("PYRO.Sobrecarga.Teste", { nivel: calc.sobrecarga, nd: calc.nd, total: testeRoll?.total ?? 0 })}
      — <strong>${loc(falhou ? "PYRO.Chat.Falha" : "PYRO.Chat.Sucesso")}</strong></p>
      ${!falhou ? `<p>${loc("PYRO.Sobrecarga.Resistiu")}</p>` : ""}
      ${efeitosSobrecarga.length ? `<ul>${efeitosSobrecarga.map(e => `<li>${e}</li>`).join("")}</ul>` : ""}
    </div>`);
  }

  for (const pr of calc.porRuna) {
    const sys = pr.item.system;
    const nomeRuna = esc(sys.palavra || pr.item.name);
    // Tipo "Não causa dano": os dados não são rolados, o resto continua.
    const semDano = pr.tipoDano === SEM_DANO;

    for (const sc of pr.scalings) {
      const bruto = valorScaling(sc, pr.intencao);
      // Línguas mais puras multiplicam os valores (floor, mínimo 1 em dados).
      const valor = pr.efeitoMult !== 1 ? Math.floor(bruto * pr.efeitoMult) : bruto;
      const nomeSc = esc(sc.nome || loc("PYRO.Scaling.Efeito"));

      if (sc.faces > 0) {
        if (semDano) continue;
        const n = Math.max(1, valor);
        if (rolarDano) {
          const roll = await new Roll(`${n}d${sc.faces}`).evaluate();
          rolls.push(roll);
          // Só elemento herda tipo de dano da tabela: gesto e modificador
          // guardam um subtipo sem sentido aqui, e um Toque com dados sairia
          // como dano de energia.
          const elCfg = sys.tipoRuna === "elemento" ? PYRO.elementos[sys.subtipo] : null;
          const tipoEfetivo = pr.tipoDano || elCfg?.tipoDano || "";
          publicar(sc.nome, roll.total);
          // Subjulgar não causa dano direto: fica fora dos totais do chat.
          if (pr.subjulgar) subjulgares.push(roll.total);
          else if (tipoEfetivo === "cura") totalCura += roll.total;
          else danos.push({ tipo: tipoEfetivo, total: roll.total });
          partes.push(`<div class="pyro-dano">
            <p><strong>${nomeRuna} — ${nomeSc}</strong>: ${n}d${sc.faces}
            ${pr.efeitoMult !== 1 ? `<em>x${pr.efeitoMult}</em>` : ""}</p>
            ${await roll.render()}
          </div>`);
        } else {
          partes.push(`<p class="pyro-forma"><strong>${nomeRuna} — ${nomeSc}:</strong> ${n}d${sc.faces} (${loc("PYRO.Chat.NaoRolado")})</p>`);
        }
      } else {
        publicar(sc.nome, valor);
        partes.push(`<p class="pyro-forma"><strong>${nomeRuna} — ${nomeSc}:</strong> ${valor}</p>`);
      }
    }
    // Runa sem número nenhum (gesto livre, modificador): só o registro da Intenção.
    if (!pr.scalings.length) {
      partes.push(`<p class="pyro-forma"><strong>${nomeRuna}</strong> (${loc("PYRO.Magia.Intencao")} ${pr.intencao})</p>`);
    }
    // O efeito de referência do elemento acompanha os dados (ou vale sozinho, no Espaço).
    if (sys.tipoRuna === "elemento") {
      const efeitoTexto = loc(PYRO.elementos[sys.subtipo]?.efeito ?? "");
      if (efeitoTexto) partes.push(`<p class="pyro-efeito">${efeitoTexto}</p>`);
    }
  }

  /*
   * Bônus de dano de efeitos ("Foco em Fogo: 2d6"). Numa magia salva o
   * bônus pode estar preso a ela; numa frase montada na hora só entram os
   * bônus sem restrição de item.
   */
  if (rolarDano) {
    for (const bonus of bonusDeDano(actor, itemMagia)) {
      const roll = await new Roll(bonus.formula).evaluate();
      rolls.push(roll);
      // Sem tipo escolhido, o bônus acompanha o primeiro dano da magia.
      const tipo = bonus.tipo || danos[0]?.tipo || "";
      danos.push({ tipo, total: roll.total });
      const rotulo = tipo ? loc(PYRO.tiposDano[tipo]?.label ?? tipo) : "";
      partes.push(`<div class="pyro-dano">
        <p><strong>${esc(bonus.nome)}</strong>${rotulo ? ` — ${rotulo}` : ""}</p>
        ${await roll.render()}
      </div>`);
    }
  }

  // Magias de morte não causam dano direto: entram com a tabela de comparação.
  for (const total of subjulgares) {
    partes.push(tabelaSubjulgar(actor.system.det, total));
  }

  // Botões dos efeitos de uso: os da magia salva e os das runas da frase.
  partes.push(htmlEfeitosDeUso(itemMagia, calc.porRuna.map(pr => pr.item)));
  // Só magia salva progride: frase montada na hora não tem onde contar o uso.
  partes.push(htmlClasseDaRolagem(classe, itemMagia));

  variaveis.danoTotal = danos.reduce((t, d) => t + d.total, 0);
  variaveis.cura = totalCura;

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="pyro-chat">${partes.join("")}</div>`,
    rolls,
    flags: flagsDoSistema({ danos, cura: totalCura, variaveis, ...flagsDaClasse(classe, itemMagia) }),
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
