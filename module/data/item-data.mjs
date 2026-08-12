import { PYRO } from "../config.mjs";

const fields = foundry.data.fields;

const num = (initial, opts = {}) =>
  new fields.NumberField({ required: true, integer: true, initial, ...opts });

const dec = (initial, opts = {}) =>
  new fields.NumberField({ required: true, initial, ...opts });

const str = (initial = "", opts = {}) =>
  new fields.StringField({ required: true, initial, ...opts });

class BaseItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return { descricao: new fields.HTMLField() };
  }
}

/* ---------------------------- Arma ---------------------------------------- */

export class ArmaData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      // Cada entrada é uma rolagem de dano com seu tipo. Aceita atributos
      // como bônus: "2d8 + @des" (ver Actor#getRollData).
      danos: new fields.ArrayField(new fields.SchemaField({
        formula: str("2d6"),
        tipo: str("impacto")
      }), { initial: [{ formula: "2d6", tipo: "impacto" }] }),
      usaMunicao: new fields.BooleanField({ initial: false }),
      acoes: num(2, { min: 1 }),
      maos: num(1, { min: 1, max: 2 }),
      // Alcance menor: até aqui o tiro é normal. Além dele, e até o máximo,
      // o teste de mira recebe desvantagem (SRD §5). 0 = corpo a corpo.
      alcanceMenor: num(0, { min: 0 }),
      alcanceMaximo: num(0, { min: 0 }),
      peso: num(0, { min: 0 }),
      custo: num(0, { min: 0 }),
      quantidade: num(1, { min: 0 })
    };
  }

  /** Migra dano/tipoDano/tiposDano antigos e o alcance em texto. */
  static migrateData(source) {
    if (typeof source.alcance === "string" && source.alcanceMenor === undefined) {
      const nums = source.alcance.match(/\d+/g)?.map(Number) ?? [0];
      source.alcanceMenor = nums[0] ?? 0;
      source.alcanceMaximo = nums[1] ?? nums[0] ?? 0;
      delete source.alcance;
    }
    if (source.danos === undefined && (source.dano !== undefined || source.tiposDano)) {
      const tipos = source.tiposDano ?? [source.tipoDano ?? "impacto"];
      source.danos = tipos.map((t, i) => ({
        formula: i === 0 ? (source.dano ?? "2d6") : "",
        tipo: t
      }));
      delete source.dano;
      delete source.tipoDano;
      delete source.tiposDano;
    }
    return super.migrateData(source);
  }
}

/* ---------------------------- Equipamento ---------------------------------- */

export class EquipamentoData extends BaseItemData {
  static defineSchema() {
    const tipos = Object.keys(PYRO.tiposDano).reduce((acc, t) => {
      acc[t] = num(0);
      return acc;
    }, {});
    return {
      ...super.defineSchema(),
      parte: str("peitoral", { choices: Object.keys(PYRO.partesCorpo) }),
      equipado: new fields.BooleanField({ initial: false }),
      // Bônus de defesa por categoria E por tipo específico.
      defesas: new fields.SchemaField({
        categorias: new fields.SchemaField({
          fisico: num(0), energetico: num(0), mental: num(0)
        }),
        tipos: new fields.SchemaField(tipos)
      }),
      // Dados extras somados às reações: "1d4" no bloqueio, "1d12" na esquiva.
      bloqueio: str(""),
      esquiva: str(""),
      peso: num(0, { min: 0 }),
      custo: num(0, { min: 0 }),
      quantidade: num(1, { min: 0 })
    };
  }

  /** Migra defesas antigas e a parte "escudo", que virou mãos. */
  static migrateData(source) {
    if (source.parte === "escudo") source.parte = "maos";
    const d = source.defesas;
    if (d && !("categorias" in d)) {
      source.defesas = {
        categorias: {
          fisico: d.fisico ?? 0,
          energetico: d.energetico ?? 0,
          mental: d.mental ?? 0
        },
        tipos: {}
      };
    }
    return super.migrateData(source);
  }
}

/* ---------------------------- Consumível ----------------------------------- */

export class ConsumivelData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      acoes: num(2, { min: 0 }),
      formula: str(""), // ex: "2d8" (cura) ou dano da munição ("2d10")
      municao: new fields.BooleanField({ initial: false }),
      tipoDano: str("perfurante"), // usado quando é munição
      // Munição pode ser presa nas costas ou na cintura.
      equipado: new fields.BooleanField({ initial: false }),
      parte: str("cintura"),
      peso: num(0, { min: 0 }),
      custo: num(0, { min: 0 }),
      quantidade: num(1, { min: 0 })
    };
  }
}

/* ---------------------------- Habilidade ----------------------------------- */

/** Habilidades de Caminho, gerais e técnicas marciais. */
export class HabilidadeData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      caminho: str(""), // id do Caminho de origem ("geral" para habilidades gerais)
      // Perícia, passiva ou ativável — organiza a lista da ficha.
      categoria: str("ativavel", { choices: Object.keys(PYRO.categoriasHabilidade) }),
      // Habilidades de caminhos de Classe podem ser técnicas (aba própria).
      ehTecnica: new fields.BooleanField({ initial: false }),
      // A habilidade base vem junto do caminho: não custa XP nem entra na
      // conta do custo da próxima habilidade.
      ehBase: new fields.BooleanField({ initial: false }),
      // Habilidades de caminhos que concedem recurso próprio (Energia Natural)
      // podem morar na aba daquele caminho.
      abaCaminho: new fields.BooleanField({ initial: false }),
      tier: num(1, { min: 1 }),
      custoXp: num(10, { min: 0 }),
      custoEstamina: num(0, { min: 0 }),
      custoMana: num(0, { min: 0 }),
      custoEnergia: num(0, { min: 0 }),
      custoAcoes: num(0, { min: 0 }),
      // A habilidade gasta ações do próprio turno ou reações fora dele.
      tipoCusto: str("acao", { choices: Object.keys(PYRO.tiposCusto) }),
      formula: str("")
    };
  }
}

/* ---------------------------- Feitiço --------------------------------------- */

/** Magia demoníaca (Humano Feiticeiro). Cru por enquanto, efeitos virão. */
export class FeiticoData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      custoAcoes: num(0, { min: 0 }),
      formula: str("")
    };
  }
}

/* ---------------------------- Runa ------------------------------------------ */

export class RunaData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      tipoRuna: str("elemento", { choices: Object.keys(PYRO.tiposRuna) }),
      // Subtipo depende do tipoRuna; a ficha filtra as opções (e as afinidades
      // do mago limitam os elementos disponíveis).
      subtipo: str("fogo"),
      // A palavra/gesto em si ("Chamas", "Brasa").
      palavra: str(""),
      lingua: str("humana"), // línguas são configuráveis pelo mestre
      /*
       * O que esta runa produz por Intenção:
       *   valor = floor(base + porIntencao x (Intenção - 1))
       * faces > 0 rola (valor)d(faces); faces 0 é um número plano (metros,
       * alvos, rodadas). Nasce preenchido pelas regras do elemento/gesto e
       * fica editável aqui — as magias montadas leem daqui.
       */
      scalings: new fields.ArrayField(new fields.SchemaField({
        nome: new fields.StringField({ required: true, initial: "" }),
        base: dec(0),
        porIntencao: dec(0),
        faces: num(0, { min: 0 })
      }), { initial: [] })
    };
  }

  /** Elementos são verbais; formas e modificadores são gestos (somáticos). */
  get somatica() {
    return this.tipoRuna !== "elemento";
  }
}

/* ---------------------------- Magia (grimório) ------------------------------- */

/**
 * Uma frase rúnica salva: apenas o conjunto de palavras. As Intenções são
 * escolhidas a cada conjuração e os escalonamentos vivem em cada runa, então
 * ajustar uma runa vale para todas as magias que a usam.
 */
export class MagiaData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      runas: new fields.ArrayField(new fields.SchemaField({
        itemId: new fields.StringField({ required: true }),
        nome: new fields.StringField({ required: true })
      }))
    };
  }

  /** Magias antigas guardavam os escalonamentos; agora eles moram na runa. */
  static migrateData(source) {
    if (Array.isArray(source.runas)) {
      source.runas = source.runas.map(r => ({ itemId: r.itemId, nome: r.nome }));
    }
    return super.migrateData(source);
  }
}

/* ---------------------------- Caminho ---------------------------------------- */

export class CaminhoData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      // Caminho racial (raça) ou de profissão/classe.
      ehRacial: new fields.BooleanField({ initial: false }),
      // Nome livre da profissão/classe; vira "Caminho do <nome>".
      nomeCaminho: str(""),
      // Só relevantes em caminhos raciais:
      raca: str("humano"), // lista de raças é configurável pelo mestre
      racaDetalhe: str(""), // especialização escrita ("elfo (...)", "Outro"...)
      // Qualquer caminho (racial ou de classe) pode conceder magia/feitiçaria.
      usaMagia: new fields.BooleanField({ initial: false }),
      usaFeiticaria: new fields.BooleanField({ initial: false }),
      // Potencial mágico: mesma escala das línguas rúnicas (humana, élfica...).
      potencial: str("humana"),
      // Recursos personalizados concedidos por este caminho (Energia Natural etc).
      recursos: new fields.ArrayField(new fields.StringField({ required: true }), { initial: [] }),
      // Afinidades elementais do mago: lista de opções, "outro" com texto livre.
      afinidades: new fields.ArrayField(new fields.SchemaField({
        // Sem choices: as afinidades derivam dos elementos, que o mestre edita
        // nas configurações do mundo (validar aqui travaria chaves novas).
        tipo: new fields.StringField({ required: true, initial: "fogo" }),
        outro: new fields.StringField({ required: true, initial: "" })
      }), { initial: [] }),
      // O tamanho vem da raça; só o primeiro caminho racial do ator define.
      tamanho: str("medio", { choices: Object.keys(PYRO.tamanhos) }),
      xp: num(0, { min: 0 })
    };
  }

  /** Migra tipos antigos (profissao/classe) e afinidades em texto livre. */
  static migrateData(source) {
    if (source.tipoCaminho !== undefined) {
      source.ehRacial = source.tipoCaminho === "racial";
      delete source.tipoCaminho;
    }
    // Elfo (Mago) e Elfo (especificar) viraram um preset só.
    if (["elfoMago", "elfoOutro"].includes(source.raca)) source.raca = "elfo";
    // Humano (Mago) e Humano (Feiticeiro) também: a escolha virou checkbox,
    // então a capacidade que a raça dava é preservada aqui.
    if (source.raca === "humanoMago") {
      source.raca = "humano";
      if (!source.usaMagia) source.usaMagia = true;
    }
    if (source.raca === "humanoFeiticeiro") {
      source.raca = "humano";
      if (!source.usaFeiticaria) source.usaFeiticaria = true;
    }
    if (source.raca && source.usaMagia === undefined) {
      const preset = PYRO.racas[source.raca];
      if (preset) {
        source.usaMagia = preset.magia;
        source.usaFeiticaria = preset.feiticos;
        source.potencial = preset.potencial;
      }
    }
    if (typeof source.afinidades === "string") {
      const mapa = {
        fogo: "fogo", agua: "aguaGelo", gelo: "aguaGelo", ar: "arVento",
        vento: "arVento", pedra: "pedraTerra", terra: "pedraTerra",
        raio: "raio", vida: "vida", morte: "morte", espaco: "espaco", mente: "mente"
      };
      source.afinidades = source.afinidades.split(",")
        .map(t => t.trim()).filter(Boolean)
        .map(t => {
          const chave = mapa[t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
          return chave ? { tipo: chave, outro: "" } : { tipo: "outro", outro: t };
        });
    }
    return super.migrateData(source);
  }

  prepareDerivedData() {
    const actor = this.parent?.actor;
    // XP gasta é a soma do custo das habilidades deste caminho (o vínculo
    // aceita o id ou o nome, pra não quebrar fichas antigas).
    const habilidades = actor?.items.filter(i =>
      i.type === "habilidade"
      && (i.system.caminho === this.parent.id || i.system.caminho === this.parent.name)
    ) ?? [];
    this.xpGasta = habilidades.reduce((t, i) => t + (i.system.custoXp ?? 0), 0);
    this.xpDisponivel = this.xp - this.xpGasta;
    // Custo da próxima habilidade: 10 x (habilidades já obtidas + 1).
    // A habilidade base do caminho não entra nessa conta.
    const obtidas = habilidades.filter(i => !i.system.ehBase).length;
    this.proximoCusto = 10 * (obtidas + 1);
  }
}
