# Sends to RiffBoyz #game channel (and mentions zutedude) - it's just {{ }} in terminal (this is a just escape)
send-test-relay:
    @echo "Sending test relay..."
    curl -X POST https://mono-project-257add9f4c24.herokuapp.com/relay/messages \
    -H "Authorization: 00000000-0000-0000-0010-000000000000" \
    -H "Content-Type: application/json" \
    -d '{"guildId": "1177719384668635196","channelId": "1177719384668635199","payload": { "content": "Hello {{{{zutedude}}" }}'