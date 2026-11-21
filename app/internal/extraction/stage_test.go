package extraction

import (
	"encoding/json"
	"strings"
	"testing"
)

const validChinaUtility = `{"doc_type":"china_utility","supplier_name":"国网北京市电力公司",
	"account_no":"1234567890","amount_kwh":523.5,"amount_yuan":312.7,
	"period_start":"2025-09-01","period_end":"2025-09-30","confidence":"high"}`

const validTravel = `{"doc_type":"travel","supplier_name":"中国铁路","mode":"rail",
	"passenger_name":"李四","origin":"上海虹桥站","destination":"北京南站",
	"departure_at":"2026-04-22T14:30","arrival_at":"2026-04-22T20:15",
	"travel_class":"二等座","distance_km":null,"flight_or_train_no":"G102",
	"vehicle_plate":null,"amount_yuan":553,"ticket_no":"E123456789","confidence":"high"}`

const validFuelReceipt = `{"doc_type":"fuel_receipt","supplier_name":"中国石化北京加油站",
	"fuel_type":"92#汽油","fuel_category":"gasoline","volume_l":38.5,
	"unit_price_yuan":7.85,"amount_yuan":302.23,"occurred_at":"2026-04-15",
	"license_plate":"京A12345","confidence":"high"}`

const validFreight = `{"doc_type":"freight","supplier_name":"顺丰速运","mode":"road",
	"vehicle_class":"冷链车","weight_kg":1250,"volume_m3":4.5,"distance_km":null,
	"origin":"广州市番禺区","destination":"上海市浦东新区","tracking_no":"SF1234567890",
	"amount_yuan":2680,"occurred_at":"2026-05-08","confidence":"high"}`

const validPurchase = `{"doc_type":"purchase","supplier_name":"宝山钢铁股份有限公司",
	"item_description":"热轧钢板 5mm","category":"raw_material","quantity_kg":7500,
	"amount_yuan":48650,"occurred_at":"2026-04-22","invoice_no":"12345678","confidence":"medium"}`

func TestRegistry(t *testing.T) {
	list := List()
	if len(list) != 5 {
		t.Fatalf("stages = %d, want 5", len(list))
	}
	ids := make([]string, 0, len(list))
	for _, stage := range list {
		ids = append(ids, stage.ID)
		if !stage.Vision() {
			t.Errorf("%s has no vision messages", stage.ID)
		}
		if stage.Description == "" || stage.Version == "" {
			t.Errorf("%s is missing identity fields", stage.ID)
		}
	}
	want := []string{"china_utility.v1", "freight.v1", "fuel_receipt.v1", "purchase.v1", "travel.v1"}
	if strings.Join(ids, ",") != strings.Join(want, ",") {
		t.Fatalf("stage order = %v", ids)
	}
	if _, ok := Get("missing.v1"); ok {
		t.Fatal("missing stage resolved")
	}
}

func TestStageSchemas(t *testing.T) {
	cases := []struct {
		id   string
		good string
		bad  []string
	}{
		{
			id:   "china_utility.v1",
			good: validChinaUtility,
			bad: []string{
				`{"doc_type":"china_utility","supplier_name":"x","account_no":null,
					"amount_kwh":1,"amount_yuan":null,"period_start":"","period_end":""}`,
				`{"doc_type":"other","supplier_name":"x","account_no":null,
					"amount_kwh":1,"amount_yuan":null,"period_start":"","period_end":"",
					"confidence":"high"}`,
				`{"doc_type":"china_utility","supplier_name":"x","account_no":null,
					"amount_kwh":"1","amount_yuan":null,"period_start":"","period_end":"",
					"confidence":"high"}`,
			},
		},
		{
			id:   "fuel_receipt.v1",
			good: validFuelReceipt,
			bad: []string{
				`{"doc_type":"fuel_receipt","supplier_name":"x","fuel_type":"92#",
					"fuel_category":"kerosene","volume_l":1,"unit_price_yuan":null,
					"amount_yuan":1,"occurred_at":"","license_plate":null,"confidence":"high"}`,
				`{"doc_type":"fuel_receipt","supplier_name":"x","fuel_type":"92#",
					"fuel_category":"gasoline","volume_l":1,"unit_price_yuan":null,
					"amount_yuan":1,"occurred_at":"","confidence":"high"}`,
			},
		},
		{
			id:   "freight.v1",
			good: validFreight,
			bad: []string{
				`{"doc_type":"freight","supplier_name":"x","mode":"ship","vehicle_class":null,
					"weight_kg":1,"volume_m3":null,"distance_km":null,"origin":"a",
					"destination":"b","tracking_no":null,"amount_yuan":1,
					"occurred_at":"","confidence":"high"}`,
				`{"doc_type":"freight","supplier_name":"x","mode":"road","vehicle_class":null,
					"weight_kg":1,"volume_m3":null,"distance_km":"far","origin":"a",
					"destination":"b","tracking_no":null,"amount_yuan":1,
					"occurred_at":"","confidence":"high"}`,
			},
		},
		{
			id:   "purchase.v1",
			good: validPurchase,
			bad: []string{
				`{"doc_type":"purchase","supplier_name":"x","item_description":"steel",
					"category":"steel","quantity_kg":null,"amount_yuan":1,
					"occurred_at":"","invoice_no":null,"confidence":"high"}`,
				`{"doc_type":"purchase","supplier_name":"x","item_description":"steel",
					"category":"raw_material","quantity_kg":"7500","amount_yuan":1,
					"occurred_at":"","invoice_no":null,"confidence":"high"}`,
			},
		},
		{
			id:   "travel.v1",
			good: validTravel,
			bad: []string{
				`{"doc_type":"travel","supplier_name":"x","mode":"boat","passenger_name":null,
					"origin":"a","destination":"b","departure_at":"","arrival_at":null,
					"travel_class":null,"distance_km":null,"flight_or_train_no":null,
					"vehicle_plate":null,"amount_yuan":1,"ticket_no":null,"confidence":"high"}`,
				`{"doc_type":"travel","supplier_name":"x","mode":"rail","passenger_name":null,
					"origin":"a","destination":"b","departure_at":"","arrival_at":null,
					"travel_class":null,"distance_km":null,"flight_or_train_no":null,
					"vehicle_plate":null,"amount_yuan":1,"confidence":"high"}`,
			},
		},
	}
	for _, tc := range cases {
		stage, ok := Get(tc.id)
		if !ok {
			t.Fatalf("stage %s missing", tc.id)
		}
		if err := stage.Validate([]byte(tc.good)); err != nil {
			t.Errorf("%s rejected a valid reply: %v", tc.id, err)
		}
		for _, bad := range tc.bad {
			if err := stage.Validate([]byte(bad)); err == nil {
				t.Errorf("%s accepted an invalid reply: %s", tc.id, bad)
			}
		}
	}
}

func TestPromptsCarryRules(t *testing.T) {
	cases := []struct {
		id       string
		needles  []string
		document string
	}{
		{
			id:       "china_utility.v1",
			needles:  []string{"<bill>", "应收合计", "户号", "Return EXACTLY ONE JSON object"},
			document: "国网电费 500 度",
		},
		{
			id:       "fuel_receipt.v1",
			needles:  []string{"<receipt>", "fuel_category", "92#汽油", "Return EXACTLY ONE JSON object"},
			document: "中国石化 92#汽油 38.5L",
		},
		{
			id:       "freight.v1",
			needles:  []string{"<receipt>", "distance_km", "中欧班列", "Return EXACTLY ONE JSON object"},
			document: "顺丰 广州 → 上海 1250kg",
		},
		{
			id:       "purchase.v1",
			needles:  []string{"<invoice>", "价税合计", "raw_material", "Return EXACTLY ONE JSON object"},
			document: "宝钢 热轧钢板 7500kg",
		},
		{
			id:       "travel.v1",
			needles:  []string{"<ticket>", "取票号", "distance_km rule", "Return EXACTLY ONE JSON object"},
			document: "G102 上海虹桥 → 北京南",
		},
	}
	for _, tc := range cases {
		stage, ok := Get(tc.id)
		if !ok {
			t.Fatalf("stage %s missing", tc.id)
		}
		prompt := stage.BuildPrompt(tc.document)
		if !strings.Contains(prompt, tc.document) {
			t.Errorf("%s prompt lost the document text", tc.id)
		}
		for _, needle := range tc.needles {
			if !strings.Contains(prompt, needle) {
				t.Errorf("%s prompt is missing %q", tc.id, needle)
			}
		}
		vision := stage.BuildVisionMessages()
		if strings.TrimSpace(vision.UserText) == "" {
			t.Errorf("%s vision text is empty", tc.id)
		}
		if !strings.Contains(vision.UserText, "Return EXACTLY ONE JSON object") {
			t.Errorf("%s vision prompt is missing the output rules", tc.id)
		}
	}
}

func TestSchemaIsValidJSON(t *testing.T) {
	for _, stage := range List() {
		var value map[string]any
		if err := json.Unmarshal(stage.Schema, &value); err != nil {
			t.Errorf("%s schema: %v", stage.ID, err)
		}
		if value["type"] != "object" {
			t.Errorf("%s schema type = %v", stage.ID, value["type"])
		}
	}
}
