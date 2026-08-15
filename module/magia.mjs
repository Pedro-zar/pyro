import { PYRO } from "./config.mjs";
import { formulaTeste } from "./dados.mjs";
import { htmlEfeitosDeUso } from "./efeitos.mjs";

const esc = s => Handlebars.escapeExpression(s);
const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** Tipo de dano que desliga a rolagem: a runa só produz efeito e números. */
export const SEM_DANO = "nenhum";

/**
 * Se true, os efeitos de sobrecarga disparam sempre que o limite seguro é
 * excedido. Se false, disparam apenas quando o teste de conjuração falha.
 * O SRD deixa ambíguo — troque aqui quando decidir no playtest.
 */
const SOBRECARGA_SEMPRE = true;

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
 * Escalonamentos padrão de uma runa, ao salvar uma magia no grimório.
 * Elementos: dados de dano da tabela (base = Intenção 1; porIntencao derivado).
 * Formas: os números da descrição (alcance/raio/extensão/PV/rodadas).
 */
const normalizar = t => (t ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

/**
 * Formas viraram gestos de texto livre; runas antigas ainda têm subtipo.
 * Tenta o subtipo legado e, se não houver, casa a palavra/nome com as
 * formas conhecidas ("Explosão" -> explosao) pra manter a automação.
 */
export function identificarForma(item) {
  const s = item.system;
  if (PYRO.formas[s.subtipo]) return s.subtipo;
  const alvo = normalizar(s.palavra || item.name);
  for (const [k, v] of Object.entries(PYRO.formas)) {
    if (alvo === k || alvo === normalizar(game.i18n.localize(v.label))) return k;
  }
  return null;
}

export function scalingsPadrao(item) {
  const s = item.system;

  if (s.tipoRuna === "elemento") {
    const cfg = PYRO.elementos[s.subtipo];
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

  if (s.tipoRuna === "forma") {
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
    for (const ref of item.system.runas ?? []) {
      if (ref.scalings?.length) juntar(ref.scalings);
      else {
        // Magia salva sem cópia própria lê o que a runa define hoje.
        const runa = item.actor?.items.get(ref.itemId)
          ?? item.actor?.items.find(i => i.type === "runa" && i.name === ref.nome);
        juntar(runa?.system.scalings);
      }
    }
  }
  return [...chaves];
}

/**
 * O que uma runa produz numa Intenção, em texto curto ("9d6 calor",
 * "raio 2m"). Alimenta a prévia do conjurador: o jogador vê o efeito antes
 * de gastar mana, e não só depois no card do chat.
 * @param {number} [efeitoMult] multiplicador da língua, quando houver.
 */
export function previaRuna(item, intencao, efeitoMult = 1, scalingsOverride = null, tipoDanoOverride = null) {
  const s = item.system;

  /*
   * Com escalonamentos definidos, a prévia vem deles — é exatamente o que a
   * conjuração vai usar (inclusive a cópia editada de uma magia salva). As
   * tabelas fixas abaixo ficam só de reserva para runas sem escalonamento.
   */
  const scalings = scalingsOverride?.length ? scalingsOverride : s.scalings;
  if (scalings?.length) {
    const cfg = s.tipoRuna === "elemento" ? PYRO.elementos[s.subtipo] : null;
    const tipoChave = (tipoDanoOverride || s.tipoDano || cfg?.tipoDano) ?? "";
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

  if (s.tipoRuna === "elemento") {
    const cfg = PYRO.elementos[s.subtipo];
    if (!cfg) return "";
    const partes = [];
    const semDano = (tipoDanoOverride || s.tipoDano) === SEM_DANO;

    if (cfg.faces && !semDano) {
      let { n, faces } = PYRO.dadosElemento(cfg, intencao);
      if (efeitoMult !== 1) n = Math.max(1, Math.floor(n * efeitoMult));
      const tipo = cfg.tipoDano
        ? loc(PYRO.tiposDano[cfg.tipoDano]?.label ?? `PYRO.Dano.${cfg.tipoDano}`) : "";
      partes.push(`${n}d${faces}${tipo ? ` ${tipo}` : ""}`);
    }
    // Efeitos próprios que escalam junto (corrente do raio).
    for (const extra of cfg.extras ?? []) {
      const valor = valorScaling(extra, intencao);
      if (valor > 0) partes.push(`${loc(extra.nome)} ${valor}`);
    }
    return partes.join(" · ");
  }

  if (s.tipoRuna === "forma") {
    const chave = identificarForma(item);
    const cfg = chave ? PYRO.formas[chave] : null;
    if (!cfg) return "";
    const d = cfg.desc(intencao);
    return loc(d.key, d.data);
  }

  return loc(PYRO.modificadores[s.subtipo] ?? "");
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

    const mult = PYRO.multiplicadorSubjulgar(faixa.dif);
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
 */
export function calcular(actor, escolhas) {
  const fatorRaca = actor.system.fatorLinguistico ?? 1;
  const limiteBase = actor.system.sobrecargaLimite;

  let custoTotal = 0;
  let sobrecarga = 0;
  let somaIntencoes = 0;
  let maosUsadas = 0;
  const porRuna = [];

  for (const { item, intencao, scalings, subjulgar, tipoDano } of escolhas) {
    const s = item.system;
    const lingua = PYRO.linguas[s.lingua];
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
    if (s.tipoRuna !== "elemento") maosUsadas += s.maos ?? 1;
    porRuna.push({
      item, intencao, custo, limite, excesso,
      // Escalonamentos e modo Subjulgar vivem na runa; os parâmetros servem
      // de sobreposição (a cópia editada de uma magia salva).
      scalings: scalings ?? s.scalings,
      subjulgar: subjulgar ?? s.subjulgar ?? false,
      tipoDano: tipoDano || s.tipoDano || "",
      efeitoMult: lingua.efeito
    });
  }

  return {
    porRuna,
    custoTotal,
    sobrecarga,
    somaIntencoes,
    maos: maosUsadas,
    acoes: escolhas.length, // 1 ação por runa verbal ou somática (SRD §5)
    nd: 10 + somaIntencoes,
    temElemento: escolhas.some(e => e.item.system.tipoRuna === "elemento"),
    temForma: escolhas.some(e => e.item.system.tipoRuna === "forma")
  };
}

/* -------------------------------------------------------------------------- */
/*  Conjuração                                                                */
/* -------------------------------------------------------------------------- */

export async function conjurar(actor, escolhas, {
  nomeMagia = null, rolarDano = true, itemMagia = null
} = {}) {
  if (!escolhas.length) return;

  const calc = calcular(actor, escolhas);
  const r = actor.system.recursos;

  // Toda magia precisa de ao menos um Elemento e uma Forma (SRD Magia).
  if (!calc.temElemento || !calc.temForma) {
    return ui.notifications.warn(loc("PYRO.Avisos.ElementoEForma"));
  }
  if (calc.custoTotal > r.mana.value) {
    return ui.notifications.warn(loc("PYRO.Avisos.SemMana", { custo: calc.custoTotal, mana: r.mana.value }));
  }
  const maosDisponiveis = actor.system.maos ?? 2;
  if (calc.maos > maosDisponiveis) {
    return ui.notifications.warn(loc("PYRO.Avisos.SemMaos", { usadas: calc.maos, maos: maosDisponiveis }));
  }

  /* --- Teste de sobrecarga (SAB ou INT, o maior) vs 10 + soma Intenções --- */
  let testeRoll = null;
  let falhou = false;
  if (calc.sobrecarga > 0) {
    const a = actor.system.atributos;
    // AJUSTE: "teste de SAB ou INT" — automatizei pro maior dos dois.
    const chave = a.sab.efetivo >= a.int.efetivo ? "sab" : "int";
    const formula = formulaTeste(a[chave].efetivo);
    testeRoll = await new Roll(formula).evaluate();
    falhou = testeRoll.total < calc.nd;
  }

  /* --- Gasto de mana (acontece mesmo na falha) ---------------------------- */
  const updates = { "system.recursos.mana.value": r.mana.value - calc.custoTotal };

  /* --- Efeitos de sobrecarga --------------------------------------------- */
  const efeitosSobrecarga = [];
  if (calc.sobrecarga > 0 && (SOBRECARGA_SEMPRE || falhou)) {
    if (calc.sobrecarga >= 1) {
      const perda = 2 * calc.custoTotal;
      updates["system.recursos.estamina.value"] = Math.max(0, r.estamina.value - perda);
      efeitosSobrecarga.push(loc("PYRO.Sobrecarga.Nivel1", { valor: perda }));
    }
    if (calc.sobrecarga >= 2) {
      updates["system.recursos.pv.value"] = Math.max(0, r.pv.value - calc.custoTotal);
      efeitosSobrecarga.push(loc("PYRO.Sobrecarga.Nivel2", { valor: calc.custoTotal }));
    }
    if (calc.sobrecarga >= 3) efeitosSobrecarga.push(loc("PYRO.Sobrecarga.Nivel3"));
    if (calc.sobrecarga >= 4) efeitosSobrecarga.push(loc("PYRO.Sobrecarga.Nivel4"));
  }
  await actor.update(updates);

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

  // Runas usadas
  const nativa = actor.system.linguaNativa;
  const linhas = calc.porRuna.map(pr => {
    const s = pr.item.system;
    const tipo = loc(PYRO.tiposRuna[s.tipoRuna]);
    const lingua = s.lingua !== nativa ? ` · ${loc(PYRO.linguas[s.lingua].label)}` : "";
    return `<li><strong>${esc(s.palavra || pr.item.name)}</strong>
      <span class="pyro-runa-meta">${tipo}${lingua} · ${loc("PYRO.Magia.Intencao")} ${pr.intencao}
      · ${pr.custo} ${loc("PYRO.Recursos.mana")}</span></li>`;
  }).join("");
  partes.push(`<ul class="pyro-runas-usadas">${linhas}</ul>`);

  // Teste de sobrecarga
  if (testeRoll) {
    partes.push(`<div class="pyro-sobrecarga ${falhou ? "falha" : "sucesso"}">
      <p>${loc("PYRO.Sobrecarga.Teste", { nivel: calc.sobrecarga, nd: calc.nd, total: testeRoll.total })}
      — <strong>${loc(falhou ? "PYRO.Chat.Falha" : "PYRO.Chat.Sucesso")}</strong></p>
      ${falhou ? `<p>${loc("PYRO.Sobrecarga.Falhou")}</p>` : ""}
      ${efeitosSobrecarga.length ? `<ul>${efeitosSobrecarga.map(e => `<li>${e}</li>`).join("")}</ul>` : ""}
    </div>`);
  }

  if (!falhou) {
    for (const pr of calc.porRuna) {
      const s = pr.item.system;
      const nomeRuna = esc(s.palavra || pr.item.name);
      // Tipo "Não causa dano": os dados não são rolados, o resto continua.
      const semDano = pr.tipoDano === SEM_DANO;

      /* --- Escalonamentos customizados (magias salvas) -------------------- */
      if (pr.scalings?.length) {
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
              const elCfg = PYRO.elementos[s.subtipo];
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
        // Efeito de referência do elemento continua visível.
        if (s.tipoRuna === "elemento") {
          const efeitoTexto = loc(PYRO.elementos[s.subtipo]?.efeito ?? "");
          if (efeitoTexto) partes.push(`<p class="pyro-efeito">${efeitoTexto}</p>`);
        }
        continue;
      }

      /* --- Comportamento padrão (conjuração direta) ------------------------ */
      if (s.tipoRuna === "forma") {
        const chave = identificarForma(pr.item);
        const cfg = chave ? PYRO.formas[chave] : null;
        if (cfg) {
          const d = cfg.desc(pr.intencao);
          // Os números da Forma (alcance, raio, extensão) também viram variáveis.
          for (const [nome, valor] of Object.entries(d.data ?? {})) publicar(nome, valor);
          partes.push(`<p class="pyro-forma"><strong>${nomeRuna}:</strong> ${loc(d.key, d.data)}</p>`);
        } else {
          // Gesto livre: sem automação, só o registro da Intenção.
          partes.push(`<p class="pyro-forma"><strong>${nomeRuna}</strong> (${loc("PYRO.Magia.Intencao")} ${pr.intencao})</p>`);
        }
      } else if (s.tipoRuna === "modificador") {
        const key = PYRO.modificadores[s.subtipo];
        partes.push(`<p class="pyro-forma"><strong>${nomeRuna}
          (${loc("PYRO.Magia.Intencao")} ${pr.intencao})</strong>${key ? `: ${loc(key)}` : ""}</p>`);
      } else if (s.tipoRuna === "elemento") {
        const cfg = PYRO.elementos[s.subtipo];
        if (!cfg) continue;
        const efeito = loc(cfg.efeito ?? "");
        // Espaço não tem dano padrão; "Não causa dano" desliga o do elemento.
        if (!cfg.faces || semDano) {
          if (efeito) partes.push(`<p class="pyro-efeito">${efeito}</p>`);
          continue;
        }

        let { n, faces } = PYRO.dadosElemento(cfg, pr.intencao);
        if (pr.efeitoMult !== 1) n = Math.max(1, Math.floor(n * pr.efeitoMult));
        const tipoEfetivo = pr.tipoDano || cfg.tipoDano || "";
        const tipoDano = tipoEfetivo ? loc(PYRO.tiposDano[tipoEfetivo]?.label ?? `PYRO.Dano.${tipoEfetivo}`) : "";

        if (rolarDano) {
          const roll = await new Roll(`${n}d${faces}`).evaluate();
          rolls.push(roll);
          publicar(loc("PYRO.Scaling.Dano"), roll.total);
          if (pr.subjulgar) subjulgares.push(roll.total);
          else if (tipoEfetivo === "cura") totalCura += roll.total;
          else danos.push({ tipo: tipoEfetivo, total: roll.total });
          partes.push(`<div class="pyro-dano">
            <p><strong>${loc(cfg.label)}</strong> — ${n}d${faces}${tipoDano ? ` (${tipoDano})` : ""}
            ${pr.efeitoMult !== 1 ? `<em>x${pr.efeitoMult}</em>` : ""}</p>
            ${await roll.render()}
            <p class="pyro-efeito">${efeito}</p>
          </div>`);
        } else {
          partes.push(`<p class="pyro-forma"><strong>${loc(cfg.label)}:</strong> ${n}d${faces}${tipoDano ? ` (${tipoDano})` : ""} (${loc("PYRO.Chat.NaoRolado")})</p>
            <p class="pyro-efeito">${efeito}</p>`);
        }
      }
    }

    // Magias de morte não causam dano direto: entram com a tabela de comparação.
    for (const total of subjulgares) {
      partes.push(tabelaSubjulgar(actor.system.det, total));
    }

    /*
     * Efeitos de uso da magia salva e das runas da frase. Sem isto, um efeito
     * criado na magia nunca chegava ao chat: o card da conjuração era o único
     * que não montava os botões.
     */
    partes.push(htmlEfeitosDeUso(itemMagia, calc.porRuna.map(pr => pr.item)));
  }

  variaveis.danoTotal = danos.reduce((t, d) => t + d.total, 0);
  variaveis.cura = totalCura;

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="pyro-chat">${partes.join("")}</div>`,
    rolls,
    flags: { pyro: { danos, cura: totalCura, variaveis } },
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
    const item = actor.items.get(ref.itemId)
      ?? actor.items.find(i => i.type === "runa" && i.name === ref.nome);
    // Cópia vazia (magia salva antes da cópia existir) cai nos scalings da runa.
    if (item) {
      frase.push({
        id: item.id, intencao: 1, original: true,
        // Sem cópia própria, ambos caem no que a runa define hoje.
        scalings: ref.scalings?.length ? foundry.utils.deepClone(ref.scalings) : undefined,
        subjulgar: ref.scalings?.length ? !!ref.subjulgar : undefined,
        tipoDano: ref.scalings?.length ? (ref.tipoDano || undefined) : undefined
      });
    }
    else faltando.push(ref.nome);
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
